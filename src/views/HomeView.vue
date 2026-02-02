<template>
    <v-container fluid>
        <v-card class="rounded-xl elevation-10 ma-auto mt-1" width="80vw">
            <v-card-title class="text-center">Enviando minhas fotos...</v-card-title>
            <v-card-subtitle class="text-pre-wrap">Selecione as fotos que vão para o quarto escuro</v-card-subtitle>

            <v-card-text class="pa-2 overflow-x-visible">
                <hr />
                <p class="text-h6">Identificador: <b>{{ identifier }}</b></p>
                <hr class="mb-4" />
                <v-file-input v-model="files" label="Escolha imagens" multiple accept="image/*" variant="outlined"
                    density="comfortable"></v-file-input>

                <div v-if="fileList.length" class="mt-4">
                    <div v-for="f in fileList" :key="f.id" class="mb-3">
                        <div class="d-flex justify-space-between">
                            <div><strong>{{ f.name }}</strong> <small>({{ humanFileSize(f.size) }})kb</small></div>
                            <div v-if="f.status === 'done'">✅ Concluído</div>
                            <div v-else-if="f.status === 'error'">❌ Erro</div>
                            <div v-else>{{ f.progress }}%</div>
                        </div>
                        <v-progress-linear :value="f.progress" height="8" class="mt-2"></v-progress-linear>
                    </div>
                </div>
            </v-card-text>

            <v-card-actions>
                <v-spacer />
                <v-btn :disabled="!canSend" color="primary" @click="sendFiles">Enviar</v-btn>
            </v-card-actions>
        </v-card>

        <v-footer app class="bg-red-lighten-1">
            <div class="pa-2">
                <strong>Conexão: </strong>
                <span v-if="wsState === WsState.open">Conectado ✅ com {{ identifier }}</span>
                <span v-else-if="wsState === WsState.connecting">Conectando...</span>
                <span v-else-if="wsState === WsState.closed">Desconectado</span>
                <span v-if="remoteStatus"> — Máquina: {{ remoteStatus }}</span>
            </div>
        </v-footer>
        <v-dialog v-model="showDialog" persistent>
            <v-card class="bg-red-lighten-1 rounded-xl" width="90vwd">
                <v-card-title class="text-center">Tranferência concluída!</v-card-title>
                <v-card-text>
                    <p class="text-justify">Suas fotos já devem estar aparecendo na tela do kiosk. Customize e imprima
                        suas fotos a partir de lá.</p>
                    <p class="text-justify">Para novas fotos reinicie o processo lendo o QRCode novamente.</p>
                </v-card-text>
            </v-card>
        </v-dialog>
    </v-container>
</template>

<script setup lang="ts">
    import { ref, computed, onBeforeMount, onUnmounted } from "vue";
    import { useRoute } from "vue-router";
    import CryptoJS from "crypto-js";


    enum FileStatus { "idle", "sending", "done", "error" }

    type FileItem = {
        id: string;
        file: File;
        name: string;
        size: number;
        progress: number;
        status: FileStatus;
        lastModified: number,
        seq?: number;
    };

    const route = useRoute();

    const id = ref("");
    const identifier = ref("");
    const bridgeServerAddress = ref("");
    const files = ref([] as File[]);
    const showDialog = ref(false);
    enum WsState { "closed", "connecting", "open" }

    const wsRef = ref(null as WebSocket | null);
    const wsState = ref(WsState.closed as WsState);
    const reconnectTimer = ref(null as number | null);
    const remoteStatus = ref(null);

    // Configs
    //const CHUNK_SIZE = 64 * 1024; // 64KB
    const MAX_RETRIES_PER_CHUNK = 3;
    const RECONNECT_DELAY_MS = 3000;

    function decryptUrl(encodedBridgeServerAddress: string, secret: string) {
        const decoded = decodeURIComponent(encodedBridgeServerAddress);
        const bytes = CryptoJS.AES.decrypt(decoded, secret);
        return bytes.toString(CryptoJS.enc.Utf8);
    }

    onBeforeMount(() => {
        const uuIdTotem = (route.params.id as string)?.split("-") || [];
        identifier.value = uuIdTotem.length ? uuIdTotem[uuIdTotem.length - 1] : "unknown";
        id.value = (route.params.id as string) ?? "kiosk-session";

        const encoded = route.params.encodedBridgeServerAddress as string | undefined;
        const decodedBridgeServerAddress = encoded ? decryptUrl(encoded, "picjoy2025") : null;
        bridgeServerAddress.value = decodedBridgeServerAddress ?? "wss://bridge.picjoy.com.br";

        connectWebSocket();
    });

    onUnmounted(() => {
        if (wsRef.value) {
            (wsRef.value as WebSocket).close();
            wsRef.value = null;
        }
        if (reconnectTimer.value) window.clearTimeout(reconnectTimer.value);
    });

    const fileList = computed(() =>
        (files.value as unknown as FileItem[]).map((f: FileItem) => ({
            id: `${f.name}-${f.size}-${f.lastModified}`,
            file: f,
            name: f.name,
            size: f.size,
            progress: 0,
            status: FileStatus.idle,
            lastModified: f.lastModified,
            seq: 0,
        }))
    );

    // Helper: human readable size
    function humanFileSize(bytes: number) {
        const thresh = 1024;
        if (Math.abs(bytes) < thresh) return bytes + " B";
        const units = ["KB", "MB", "GB", "TB"];
        let u = -1;
        do {
            bytes /= thresh;
            ++u;
        } while (Math.abs(bytes) >= thresh && u < units.length - 1);
        return bytes.toFixed(1) + " " + units[u];
    }

    // Connect WebSocket and register as 'web'
    function connectWebSocket() {
        if (wsRef.value) return; // já conectado ou tentando

        wsState.value = WsState.connecting;
        try {
            const url = bridgeServerAddress.value;
            const ws = new WebSocket(url);

            ws.addEventListener("open", () => {
                wsState.value = WsState.open;
                console.info("WS connected to", url);

                // Register as web client and include target session ID for convenience
                const registerMsg = {
                    type: "register",
                    role: "web",
                    id: id.value,
                    sessionId: `web-${id.value}`,
                };
                ws.send(JSON.stringify(registerMsg));

                // Send a notify to the bridge so the bridge can inform the target machine
                // (the server should forward messages of type "notify" to electrons with same session).
                const notify = {
                    type: "notify",
                    toSession: id.value,
                    message: "web_connected",
                    from: `web-${id.value}`,
                };
                ws.send(JSON.stringify(notify));
                ws.send(JSON.stringify({
                    type: "notify",
                    toSession: id.value,
                    action: "open-darkroom",
                    message: "web_connected",
                    from: `web-${id.value}`
                }));
            });

            ws.addEventListener("message", (ev: MessageEvent) => {
                // Normalize payload (could be string or binary)
                let text: string | null = null;
                if (typeof ev.data === "string") text = ev.data;
                else if (ev.data instanceof ArrayBuffer || ev.data instanceof Uint8Array) {
                    text = new TextDecoder("utf-8").decode(ev.data as any);
                } else {
                    console.warn("WS received unknown data type", typeof ev.data);
                }

                if (!text) return;

                try {
                    const data = JSON.parse(text);
                    // Example messages we expect from bridge -> machine -> web feedback:
                    // { type: 'device-status', sessionId: 'machine-1', status: 'online' }
                    // { type: 'ack-chunk', fileName, seq }
                    // { type: 'device-notify', message: 'hello' }
                    if (data.type === "device-status") {
                        remoteStatus.value = data.status;
                    } else if (data.type === "device-notify") {
                        remoteStatus.value = data.message;
                    } else if (data.type === "ack-file" && data.fileName) {
                        // you can implement ACK handling if server sends it
                        console.debug("Server ACK file:", data.fileName);
                    } else {
                        // fallback log
                        console.debug("WS message:", data);
                    }
                } catch (err) {
                    console.error("Failed to parse WS message:", err);
                }
            });

            ws.addEventListener("close", () => {
                console.warn("WS closed");
                wsRef.value = null;
                wsState.value = WsState.closed;
                scheduleReconnect();
            });

            ws.addEventListener("error", (err) => {
                console.error("WS error", err);
                // close socket to trigger reconnect path
                try { ws.close(); } catch (e) { }
            });

            wsRef.value = ws;
        } catch (err) {
            console.error("connectWebSocket error:", err);
            wsState.value = WsState.closed;
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (reconnectTimer.value) return;
        reconnectTimer.value = window.setTimeout(() => {
            reconnectTimer.value = null;
            connectWebSocket();
        }, RECONNECT_DELAY_MS);
    }

    // Convert ArrayBuffer -> Base64 (browser-friendly)
    function arrayBufferToBase64(buffer: ArrayBuffer) {
        const bytes = new Uint8Array(buffer);
        let binary = "";

        const CHUNK = 0x8000; // evita stack overflow e unicode corruption
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }

        return btoa(binary); // mantém padding correto
    }
    async function sendSingleFile(
        file: File,
        toSession: string,
        onProgress?: (p: number) => void
    ) {
        if (!wsRef.value || wsState.value !== WsState.open) {
            throw new Error("WebSocket não conectado");
        }

        // 1. Lê o arquivo inteiro como ArrayBuffer
        const buffer = await file.arrayBuffer();

        // 2. Converte buffer inteiro → base64
        const base64Full = arrayBufferToBase64(buffer);

        // 3. Envia metadados
        const meta = {
            type: "file-meta",
            toSession,
            fileName: file.name,
            size: file.size,
            mime: file.type || "application/octet-stream",
            totalBase64Length: base64Full.length,
        };
        wsRef.value.send(JSON.stringify(meta));

        // 4. Fatiar a string base64 em pedaços seguros
        const CHUNK = 64 * 1024; // 64KB (string, não bytes)
        let seq = 0;
        let sentChars = 0;

        for (let offset = 0; offset < base64Full.length; offset += CHUNK) {
            const chunk = base64Full.slice(offset, offset + CHUNK);

            const chunkMsg = {
                type: "file-chunk",
                toSession,
                fileName: file.name,
                seq,
                chunkBase64: chunk,
            };

            // retry com robustez
            let attempts = 0;
            let sent = false;
            while (attempts < MAX_RETRIES_PER_CHUNK && !sent) {
                attempts++;
                try {
                    wsRef.value.send(JSON.stringify(chunkMsg));
                    sent = true;
                } catch (err) {
                    console.warn(
                        `Erro ao enviar chunk seq=${seq}, tentativa=${attempts}`,
                        err
                    );
                    if (attempts >= MAX_RETRIES_PER_CHUNK) {
                        throw new Error(
                            `Falha ao enviar chunk seq=${seq} do arquivo ${file.name}`
                        );
                    }
                    await new Promise((r) => setTimeout(r, 200 * attempts));
                }
            }

            sentChars += chunk.length;
            seq++;

            // 5. Atualiza progresso baseado no texto enviado
            const progress = Math.min(
                100,
                Math.floor((sentChars / base64Full.length) * 100)
            );
            if (onProgress) onProgress(progress);

            await new Promise((r) => setTimeout(r, 0)); // evita travar UI
        }

        // 6. Envia finalização
        const completeMsg = {
            type: "file-complete",
            toSession,
            fileName: file.name,
        };
        wsRef.value.send(JSON.stringify(completeMsg));
    }

    // UI action: send all selected files
    async function sendFiles() {
        if (!files.value?.length) return;
        if (!wsRef.value || wsState.value !== WsState.open) {
            console.log(wsState.value)
            alert("WebSocket não conectado ao bridge. Tente novamente.");
            return;
        }

        // map fileList to mutable objects to track progress
        const list = fileList.value.map((f: any) => ({
            ...f,
            progress: 0,
            status: "sending" as const,
        }));

        // We update the original `files` ref indirectly by creating a map
        const statusMap = new Map<string, FileItem>();
        for (const item of list) statusMap.set(item.id, item);

        // Iterate sequentially (or parallelize if you want)
        for (const fileItem of list) {
            try {
                await sendSingleFile(fileItem.file, id.value, (p) => {
                    // update progress in the original files array (replace reactive content)
                    const idx = files.value.findIndex(
                        (f: any) => `${f.name}-${f.size}-${f.lastModified}` === fileItem.id
                    );
                    if (idx >= 0) {
                        // We cannot directly mutate File object; but we can keep a separate reactive structure if needed.
                        // For simplicity, update a local reactive map that the template reads via fileList computed.
                        // We'll update a small in-memory progress cache:
                        progressCache.set(fileItem.id, { progress: p, status: "sending" });
                    }
                });

                progressCache.set(fileItem.id, { progress: 100, status: "done" });
            } catch (err) {
                console.error("Erro ao enviar arquivo:", err);
                progressCache.set(fileItem.id, { progress: 0, status: "error" });
                // decide whether to continue or abort; we continue
            }
        }

        // After all done, optionally notify server to inform the machine
        try {
            wsRef.value.send(
                JSON.stringify({
                    type: "notify",
                    toSession: id.value,
                    message: "transfer_complete",
                    from: `web-${id.value}`,
                })
            );
            showDialog.value = true;
        } catch (e) {
            console.warn("Não foi possível enviar notify final", e);
        }
    }

    // Progress cache used by template via fileListProgress helper
    const progressCache = new Map<string, { progress: number; status: string }>();

    // Expose computed fileList that includes progress from progressCache
    /*const fileListComputed = computed(() =>
        files.value.map((f: any) => {
            const idKey = `${f.name}-${f.size}-${f.lastModified}`;
            const cache = progressCache.get(idKey);

            const status: FileStatus = cache
                ? cache.status === "sending"
                    ? FileStatus.sending
                    : cache.status === "done"
                        ? FileStatus.done
                        : cache.status === "error"
                            ? FileStatus.error
                            : FileStatus.idle
                : FileStatus.idle;

            return {
                id: idKey,
                file: f,
                name: f.name,
                size: f.size,
                progress: cache ? cache.progress : 0,
                status,
                lastModified: f.lastModified,
            } as FileItem;
        })
    );*/

    // Helpers for template binding
    const canSend = computed(() => files.value.length > 0 && wsState.value === WsState.open);


    // expose values used in template
    // const _ = { fileList: fileListComputed }; // unused var to keep TS satisfied

    // Replace usages in template with fileListComputed
    // But we can't change template bindings after compile; so assign fileList to computed via alias
    // -> We'll create a template-level ref using an alias:
    // const fileListAlias = fileListComputed;

</script>

<style scoped>

    /* Pequeno ajuste de espaçamento */
    .v-card-text p {
        margin: 0.25rem 0;
    }
</style>
