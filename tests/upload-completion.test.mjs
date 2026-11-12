import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Executa o script real da tela, isolando somente Vue, rede e navegador.
const source = readFileSync(new URL("../src/views/HomeView.vue", import.meta.url), "utf8")
    .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const compiled = ts.transpileModule(source + "\nexport { connectWebSocket, sendFiles, files, canSend, concluded, isSending, progressCache, uploadError, transferFailed, protocolReady, protocolVersion, showDialog };", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const limitsModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/libs/uploadLimits.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: limitsModule, exports: limitsModule.exports });

function setup({ canClose = false, closeThrows = false, failNotify = false, legacy = false, registered = true } = {}) {
    const events = [];
    const timers = [];
    let socket;
    class FakeWebSocket {
        listeners = new Map();
        messages = [];
        addEventListener(type, callback) {
            const callbacks = this.listeners.get(type) ?? [];
            callbacks.push(callback);
            this.listeners.set(type, callbacks);
        }
        emit(type, event = {}) {
            for (const callback of this.listeners.get(type) ?? []) callback(event);
        }
        constructor() { socket = this; }
        send(text) {
            const message = JSON.parse(text);
            if (failNotify && message.message === "transfer_complete") throw new Error("Rede indisponível");
            this.messages.push(message);
            events.push(message.message ?? message.type);
        }
        close() { events.push("socket-close"); }
    }
    const browser = {
        closed: false,
        close() {
            events.push("window-close");
            if (closeThrows) throw new Error("Fechamento bloqueado");
            this.closed = canClose;
        },
        location: {
            href: "https://uploader.picjoy.com.br/TEST0001",
            replace(url) { events.push(url); },
        },
        setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {},
    };
    const vue = {
        ref: value => ({ value }),
        reactive: value => value,
        computed: getter => ({ get value() { return getter(); } }),
        onBeforeMount() {}, onUnmounted() {},
    };
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        require(name) {
            if (name === "vue") return vue;
            if (name === "vue-router") return { useRoute: () => ({ params: { id: "TEST0001" } }) };
            if (name === "axios") return {};
            if (name === "uuid") return { v4: () => "synthetic-id" };
            if (name === "../libs/uploadLimits") return limitsModule.exports;
            throw new Error("Import inesperado: " + name);
        },
        WebSocket: FakeWebSocket,
        window: browser,
        console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
        Uint8Array, ArrayBuffer, TextDecoder, btoa, setTimeout,
        alert() { events.push("alert"); },
    });
    exports.connectWebSocket();
    socket.emit("open");
    if (registered) socket.emit("message", { data: JSON.stringify({ type: "registered", role: "web",
        ...(legacy ? {} : { protocolVersion: 1, uploadLimits: limitsModule.exports.UPLOAD_LIMITS }),
    }) });
    exports.files.value = [{ name: "foto-teste.jpg", size: 3, lastModified: 1, type: "image/jpeg",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }];
    return { app: exports, socket, events, timers };
}

test("aguarda o fechamento limpo do socket antes de fechar a aba", async () => {
    const { app, socket, events, timers } = setup({ canClose: true });
    await app.sendFiles();
    assert.equal(app.concluded.value, true);
    assert.equal(app.canSend.value, false);
    assert.equal(events.includes("window-close"), false);
    assert.deepEqual(events.slice(-4), ["file-chunk", "file-complete", "transfer_complete", "socket-close"]);
    socket.emit("close", { wasClean: true });
    assert.equal(events.at(-1), "window-close");
    assert.equal(events.includes("https://picjoyclub.com"), false);
    assert.equal(timers.length, 0);
});

test("redireciona do uploader ao PicJoy Club quando a aba permanece aberta", async () => {
    const { app, socket, events, timers } = setup();
    await app.sendFiles();
    socket.emit("close", { wasClean: true });
    assert.deepEqual(events.slice(-2), ["window-close", "https://picjoyclub.com"]);
    assert.equal(timers.length, 0);
});

test("redireciona ao PicJoy Club se window.close lançar erro", async () => {
    const { app, socket, events } = setup({ closeThrows: true });
    await app.sendFiles();
    assert.throws(() => socket.emit("close", { wasClean: true }), /Fechamento bloqueado/);
    assert.equal(events.at(-1), "https://picjoyclub.com");
});

test("falha em um arquivo não conclui nem encerra o lote", async () => {
    const { app, socket, events } = setup();
    app.files.value.push({ ...app.files.value[0], name: "outra-foto.jpg" });
    app.files.value[0].arrayBuffer = async () => { throw new Error("Falha ao ler arquivo"); };
    await app.sendFiles();
    assert.equal(app.concluded.value, false);
    assert.equal(app.isSending.value, false);
    assert.equal(events.includes("transfer_complete"), false);
    assert.equal(events.includes("socket-close"), false);
    assert.equal(Object.values(app.progressCache)[0].status, "error");
    assert.equal(Object.values(app.progressCache)[1].status, "done");
    socket.emit("close", { wasClean: true });
    assert.equal(events.includes("window-close"), false);
});

test("bloqueia segundo clique enquanto envia e novos envios após concluir", async () => {
    const { app, socket } = setup();
    let release;
    app.files.value[0].arrayBuffer = () => new Promise(resolve => { release = resolve; });
    const pending = app.sendFiles();
    assert.equal(app.canSend.value, false);
    await app.sendFiles();
    release(new Uint8Array([1, 2, 3]).buffer);
    await pending;
    await app.sendFiles();
    assert.equal(socket.messages.filter(message => message.type === "file-meta").length, 1);
    assert.equal(socket.messages.filter(message => message.message === "transfer_complete").length, 1);
});

test("falha na notificação final não marca conclusão nem fecha a aba", async () => {
    const { app, socket, events } = setup({ failNotify: true });
    await app.sendFiles();
    assert.equal(app.concluded.value, false);
    assert.equal(events.includes("socket-close"), false);
    socket.emit("close", { wasClean: true });
    assert.equal(events.includes("window-close"), false);
});

test("fechamento anormal após enfileirar o lote não fecha a aba nem reconecta", async () => {
    const { app, socket, events, timers } = setup();
    await app.sendFiles();
    socket.emit("close", { wasClean: false });
    assert.equal(events.includes("window-close"), false);
    assert.equal(events.includes("https://picjoyclub.com"), false);
    assert.equal(timers.length, 0);
});

test("desconexão durante o uso preserva a reconexão existente", () => {
    const { socket, events, timers } = setup();
    socket.emit("close", { wasClean: false });
    assert.equal(events.includes("window-close"), false);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 3000);
});

test("aguarda registro e anuncia a versão do protocolo sem impedir Bridge legado", async () => {
    const pending = setup({ registered: false });
    assert.equal(pending.app.canSend.value, false);
    await pending.app.sendFiles();
    assert.equal(pending.socket.messages.some(message => message.type === "file-meta"), false);
    assert.equal(pending.socket.messages[0].protocolVersion, 1);
    const legacy = setup({ legacy: true });
    await legacy.app.sendFiles();
    assert.equal(legacy.app.concluded.value, true);
    assert.equal(legacy.socket.messages.find(message => message.type === "file-meta").protocolVersion, undefined);
});

test("recusa 101 fotos, nomes repetidos e arquivo acima de 20 MiB antes de ler os dados", async () => {
    for (const scenario of ['count', 'duplicate', 'size']) {
        const { app, socket } = setup();
        const original = app.files.value[0];
        let reads = 0;
        original.arrayBuffer = async () => { reads++; throw new Error("Não deve ler"); };
        if (scenario === 'count') app.files.value = Array.from({ length: 101 }, (_, i) => ({ ...original, name: i + '.jpg' }));
        if (scenario === 'duplicate') app.files.value.push({ ...original });
        if (scenario === 'size') original.size = 20 * 1024 * 1024 + 1;
        await app.sendFiles();
        assert.equal(reads, 0);
        assert.equal(app.uploadError.value.length > 0, true);
        assert.equal(socket.messages.some(message => message.type === "file-meta"), false);
        assert.equal(app.concluded.value, false);
    }
});

test("erro do Bridge interrompe o envio em curso sem sucesso, redirecionamento ou reconexão", async () => {
    const { app, socket, events, timers } = setup();
    let release;
    app.files.value[0].arrayBuffer = () => new Promise(resolve => { release = resolve; });
    const pending = app.sendFiles();
    socket.emit("message", { data: JSON.stringify({ type: "transfer-error", code: "UPLOAD_LIMIT_EXCEEDED", message: "Limite atingido." }) });
    release(new Uint8Array([1, 2, 3]).buffer);
    await pending;
    socket.emit("close", { wasClean: true });
    assert.equal(app.uploadError.value, "Limite atingido.");
    assert.equal(app.concluded.value, false);
    assert.equal(app.canSend.value, false);
    assert.equal(events.includes("transfer_complete"), false);
    assert.equal(events.includes("window-close"), false);
    assert.equal(timers.length, 0);
});

test("rejeição após enfileirar o lote retira o diálogo de sucesso e mantém o erro visível", async () => {
    const { app, socket, events } = setup();
    await app.sendFiles();
    assert.equal(app.showDialog.value, true);
    socket.emit("message", { data: JSON.stringify({ type: "transfer-error", message: "Arquivo incompleto." }) });
    socket.emit("close", { wasClean: true });
    assert.equal(app.showDialog.value, false);
    assert.equal(app.concluded.value, false);
    assert.equal(app.uploadError.value, "Arquivo incompleto.");
    assert.equal(events.includes("window-close"), false);
});
