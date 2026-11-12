import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";

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

function loadHelper(name, mocks) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/libs/' + name + '.ts', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { module, exports: module.exports, require: name => mocks[name], crypto: webcrypto,
        TextEncoder, Uint8Array, btoa, setTimeout, clearTimeout, Error });
    return module.exports;
}
const protocol = loadHelper('confirmedProtocol', { './uploadLimits': limitsModule.exports });
const sender = loadHelper('confirmedSender', { './confirmedProtocol': protocol });
const until = async check => { for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 1)); } throw Error('Teste não progrediu'); };

function setup({ canClose = false, closeThrows = false, failNotify = false, legacy = false, registered = true, holdFinish = false, capacity = 100, capacityKnown = true } = {}) {
    const events = [];
    const timers = [];
    let socket;
    class FakeWebSocket {
        readyState = 1; bufferedAmount = 0;
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
            if (failNotify && message.operation === "finish") throw new Error("Rede indisponível");
            this.messages.push(message);
            events.push(({ start: 'file-meta', chunk: 'file-chunk', 'file-complete': 'file-complete', finish: 'transfer_complete' })[message.operation] ?? message.message ?? message.type);
            if (message.type === 'upload-request' && !(holdFinish && message.operation === 'finish')) queueMicrotask(() => this.emit('message', {
                data: JSON.stringify({ type: 'upload-ack', protocolVersion: 2, transferId: message.transferId, requestId: message.requestId }),
            }));
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
            if (name === "uuid") return { v4: (() => { let id = 0; return () => "synthetic-" + ++id; })() };
            if (name === "../libs/uploadLimits") return limitsModule.exports;
            if (name === "../libs/confirmedProtocol") return protocol;
            if (name === "../libs/confirmedSender") return sender;
            throw new Error("Import inesperado: " + name);
        },
        WebSocket: FakeWebSocket,
        window: browser,
        console: { log() {}, info() {}, debug() {}, warn() {}, error() {} },
        Uint8Array, ArrayBuffer, TextDecoder, btoa, setTimeout, clearTimeout,
        alert() { events.push("alert"); },
    });
    exports.connectWebSocket();
    socket.emit("open");
    if (registered) socket.emit("message", { data: JSON.stringify({ type: "registered", role: "web",
        ...(legacy ? {} : { protocolVersion: 2, uploadLimits: { ...limitsModule.exports.UPLOAD_LIMITS, maxFiles: capacity },
            ...(capacityKnown ? { printCapacity: { maxFiles: capacity } } : {}) }),
    }) });
    exports.files.value = [{
        slice(start, end) { return { arrayBuffer: async () => (await this.arrayBuffer()).slice(start, end) }; }, name: "foto-teste.jpg", size: 3, lastModified: 1, type: "image/jpeg",
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

test("falha de leitura aborta o lote sem sucesso nem fechar a aba", async () => {
    const { app, socket, events } = setup();
    app.files.value.push({ ...app.files.value[0], name: "outra-foto.jpg" });
    app.files.value[0].arrayBuffer = async () => { throw new Error("Falha ao ler arquivo"); };
    await app.sendFiles();
    assert.equal(app.concluded.value, false);
    assert.equal(app.isSending.value, false);
    assert.equal(events.includes("transfer_complete"), false);
    assert.equal(events.includes("window-close"), false);
    assert.equal(Object.values(app.progressCache)[0].status, "error");
    assert.equal(Object.values(app.progressCache)[1].status, "error");
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
    await until(() => release);
    release(new Uint8Array([1, 2, 3]).buffer);
    await pending;
    await app.sendFiles();
    assert.equal(socket.messages.filter(message => message.operation === "start").length, 1);
    assert.equal(socket.messages.filter(message => message.operation === "finish").length, 1);
});

test("falha na notificação final encerra o socket sem concluir nem fechar a aba", async () => {
    const { app, socket, events } = setup({ failNotify: true });
    await app.sendFiles();
    assert.equal(app.concluded.value, false);
    assert.equal(events.includes("socket-close"), true);
    socket.emit("close", { wasClean: true });
    assert.equal(events.includes("window-close"), false);
});

test("fechamento anormal após confirmar o lote não fecha a aba nem reconecta", async () => {
    const { app, socket, events, timers } = setup();
    await app.sendFiles();
    socket.emit("close", { wasClean: false });
    assert.equal(events.includes("window-close"), false);
    assert.equal(events.includes("https://picjoyclub.com"), false);
    assert.equal(timers.length, 0);
});

test("desconexão após permissão não reconecta com uma permissão consumida", () => {
    const { socket, events, timers } = setup();
    socket.emit("close", { wasClean: false });
    assert.equal(events.includes("window-close"), false);
    assert.equal(timers.length, 0);
});

test("aguarda registro v2 e exige confirmação em vez de sucesso com Bridge legado", async () => {
    const pending = setup({ registered: false });
    assert.equal(pending.app.canSend.value, false);
    await pending.app.sendFiles();
    assert.equal(pending.socket.messages.some(message => message.operation === "start"), false);
    assert.equal(pending.socket.messages[0].protocolVersion, 2);
    const legacy = setup({ legacy: true });
    await legacy.app.sendFiles();
    assert.equal(legacy.app.concluded.value, false);
    assert.equal(legacy.app.canSend.value, false);
    assert.match(legacy.app.uploadError.value, /atualizado/);
});

test("recusa quantidade excedente e arquivo vazio antes de ler os dados", async () => {
    for (const scenario of ['count', 'size']) {
        const { app, socket } = setup();
        const original = app.files.value[0];
        let reads = 0;
        original.arrayBuffer = async () => { reads++; throw new Error("Não deve ler"); };
        if (scenario === 'count') app.files.value = Array.from({ length: 101 }, (_, i) => ({ ...original, name: i + '.jpg' }));
        if (scenario === 'duplicate') app.files.value.push({ ...original });
        if (scenario === 'size') original.size = 0;
        await app.sendFiles();
        assert.equal(reads, 0);
        assert.equal(app.uploadError.value.length > 0, true);
        assert.equal(socket.messages.some(message => message.operation === "start"), false);
        assert.equal(app.concluded.value, false);
    }
});

test("erro do Bridge interrompe o envio em curso sem sucesso, redirecionamento ou reconexão", async () => {
    const { app, socket, events, timers } = setup();
    let release;
    app.files.value[0].arrayBuffer = () => new Promise(resolve => { release = resolve; });
    const pending = app.sendFiles();
    await until(() => release);
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

test('não conclui nem fecha enquanto aguarda o processamento final do Kiosk', async () => {
    const { app, socket, events } = setup({ holdFinish: true });
    const running = app.sendFiles(); await until(() => socket.messages.some(message => message.operation === 'finish'));
    assert.equal(app.concluded.value, false); assert.equal(app.showDialog.value, false);
    assert.equal(app.isSending.value, true); assert.equal(events.includes('socket-close'), false);
    const request = socket.messages.find(message => message.operation === 'finish');
    socket.emit('message', { data: JSON.stringify({ type: 'upload-ack', protocolVersion: 2, transferId: request.transferId, requestId: request.requestId }) });
    await running; assert.equal(app.concluded.value, true);
});
test('nomes iguais recebem IDs distintos no manifesto e progresso independente', async () => {
    const { app, socket } = setup(); app.files.value.push({ ...app.files.value[0] }); await app.sendFiles();
    const manifest = socket.messages.find(message => message.operation === 'start').files;
    assert.equal(manifest.length, 2); assert.notEqual(manifest[0].fileId, manifest[1].fileId);
    assert.equal(Object.keys(app.progressCache).length, 2); assert.equal(app.concluded.value, true);
});

test('lê somente fatias de até 48 KiB e não cria ArrayBuffer do arquivo inteiro', async () => {
    const { app, socket } = setup(); let reads = 0, largest = 0;
    const blob = new Blob([new Uint8Array(2 * 49152 + 1)], { type: 'image/jpeg' });
    app.files.value = [{ name: 'paisagem.jpg', type: 'image/jpeg', size: blob.size, lastModified: 1,
        arrayBuffer() { throw Error('Leitura integral proibida'); },
        slice(start, end) { reads++; largest = Math.max(largest, end - start); return blob.slice(start, end); } }];
    await app.sendFiles(); assert.equal(app.concluded.value, true);
    assert.equal(reads, 3); assert.equal(largest, 49152);
    assert.equal(socket.messages.filter(message => message.operation === 'chunk').length, 3);
});

test('limite de seleção segue o saldo; zero ou capacidade não confirmada impedem envio', async () => {
    for (const options of [{ capacity: 0 }, { capacityKnown: false }]) {
        const { app, socket } = setup(options); assert.equal(app.canSend.value, false); await app.sendFiles();
        assert.equal(socket.messages.some(message => message.operation === 'start'), false);
    }
    const { app, socket } = setup({ capacity: 1 }); app.files.value.push({ ...app.files.value[0], name: 'outra.jpg' });
    await app.sendFiles(); assert.match(app.uploadError.value, /até 1/);
    assert.equal(socket.messages.some(message => message.operation === 'start'), false);
});
test('arquivo acima do antigo teto de 20 MiB é enviado sem leitura integral', async () => {
    const { app } = setup({ capacity: 1 });
    const blob = new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/jpeg' }); let reads = 0;
    app.files.value = [{ name: 'grande.jpg', type: 'image/jpeg', size: blob.size, lastModified: 1,
        arrayBuffer() { throw Error('Leitura integral proibida'); }, slice(start, end) { reads++; return blob.slice(start, end); } }];
    await app.sendFiles(); assert.equal(app.concluded.value, true); assert.equal(reads > 400, true);
});
