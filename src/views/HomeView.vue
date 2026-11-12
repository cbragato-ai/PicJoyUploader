<template>
    <v-container fluid>
        <v-card class="rounded-xl elevation-10 ma-auto mt-1" width="85vw">
            <v-card-title class="text-center">Enviando minhas fotos...</v-card-title>
            <v-card-subtitle class="text-pre-wrap">Selecione as fotos que vão para o quarto escuro</v-card-subtitle>

            <v-card-text class="pa-2 overflow-x-visible">
                <hr />
                <p class="text-h6">Identificador: <b>{{ identifier }}</b></p>
                <hr class="mb-4" />
                <p>Envie até 100 fotos, com no máximo 20 MiB por foto e 2 GiB no total.</p>
                <v-alert v-if="uploadError" type="error" class="my-3">{{ uploadError }}</v-alert>
                <div class="d-flex justify-center mb-4">
                    <v-file-input ref="fileInputRef" v-model="files" multiple accept="image/*" class="file-input-hidden"
                        :show-size="false" :hide-details="true" />

                    <v-btn :disabled="isSending || concluded || transferFailed" variant="outlined" size="large" prepend-icon="fas fa-image"
                        class="rounded-pill bg-success text-white" @click="openFileSelector">
                        Selecionar fotos
                    </v-btn>
                </div>
                <v-alert v-if="awaitingPreparation" type="info" class="my-3">Fotos recebidas. Aguarde enquanto o totem prepara o lote.</v-alert>
                <div v-if="fileList.length" class="mt-4">
                    <div v-for="f in fileList" :key="f.id" class="mb-3">
                        <div class="d-flex justify-space-between">
                            <div><strong>{{ f.name }}</strong> <small>({{ humanFileSize(f.size) }})kb</small></div>
                            <div v-if="f.status === FileStatus.done">✅ Recebida</div>
                            <div v-else-if="f.status === FileStatus.error">❌ Erro</div>
                            <div v-else>{{ f.progress }}%</div>
                        </div>
                        <v-progress-linear :model-value="f.progress" height="12" class="mt-2" color="pink-lighten-2"
                            rounded striped></v-progress-linear>
                    </div>
                </div>
            </v-card-text>

            <v-card-actions>
                <v-spacer />
                <v-btn :disabled="!canSend" class="rounded rounded-pill bg-success text-white"
                    @click="sendFiles">Enviar</v-btn>
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
        <v-dialog v-model="userDialogShow" persistent>
            <v-card class="rounded-xl" width="90vwd">
                <v-card-title class="text-center">Bem-vindo ao PicJoy!</v-card-title>
                <v-card-text>
                    <p class="text-justify">Antes de começar preciso que se identifique para sua segurança.</p>
                    <p class="text-justify">Os dados coletados servirão para envio da Nota Fiscal após o pagamento.
                    </p>
                    <v-form ref="form" v-model="formValid">
                        <v-text-field label="E-mail" v-model="user.email" type="email" :rules="emailRules" required
                            variant="outlined" autofocus></v-text-field>
                        <v-checkbox label="CPF na Nota Fiscal" v-model="user.cpf_on_nf"></v-checkbox>
                        <v-text-field label="CPF" v-if="user.cpf_on_nf" v-model="user.cpf" type="text" :rules="cpfRules"
                            v-mask="'###.###.###-##'" variant="outlined"></v-text-field>
                        <v-checkbox label="Aceito os termos" v-model="user.accept_terms" required>
                            <template v-slot:label>
                                <span class="text-body-1">Aceito os <a href="https://picjoyclub.com/club/privacidade"
                                        target="_blank">termos de uso</a></span>
                            </template>
                        </v-checkbox>
                    </v-form>
                    <p class="text-justify">Antes de enviar os seus dados confira o código do quiosque (<b>{{ identifier
                            }}</b>).</p>
                    <p class="text-justify">Ele aparece no canto inferior direito da tela.</p>
                </v-card-text>
                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="outlined" class="rounded rounded-pill bg-success text-white" @click="sendUserData()"
                        :disabled="!formValid || !user.accept_terms || !protocolReady || protocolVersion !== CONFIRMED_PROTOCOL">Continuar</v-btn></v-card-actions>
            </v-card>
        </v-dialog>
        <v-dialog v-model="showDialog" persistent>
            <v-card class="bg-light-green-lighten-4 rounded-xl" width="90vwd">
                <v-card-title class="text-center">Tranferência concluída!</v-card-title>
                <v-card-text>
                    <p class="text-justify">Suas fotos foram recebidas e preparadas pelo kiosk. Customize e imprima
                        suas fotos a partir de lá.</p>
                    <p class="text-justify">Para novas fotos reinicie o processo lendo o QRCode novamente.</p>
                </v-card-text>
            </v-card>
        </v-dialog>
        <v-dialog v-model="showDialogSessionLocked" persistent>
            <v-card class="bg-light-red-lighten-4 rounded-xl" width="90vwd">
                <v-card-title class="text-center">Ops! Não foi possivel prosseguir!</v-card-title>
                <v-card-text>
                    <p class="text-justify">O totem está sendo usado por outro usuário no momento.</p>
                    <p class="text-justify">Aguarde até que o mesmo esteja liberado.</p>
                </v-card-text>
            </v-card>
        </v-dialog>
        <v-dialog v-model="showDialogSessionError" persistent>
            <v-card class="bg-light-red-lighten-4 rounded-xl" width="90vwd">
                <v-card-title class="text-center">Ops! Não foi possivel prosseguir!</v-card-title>
                <v-card-text>
                    <p class="text-justify">Aconteceu algum problema com o totem.</p>
                    <p class="text-justify">O mesmo não está disponível no momento.</p>
                </v-card-text>
            </v-card>
        </v-dialog>
        <v-dialog v-model="showTimeoutDialog" persistent>
            <v-card class="bg-light-green-lighten-4 rounded-xl" width="90vwd">
                <v-card-title class="text-center">O tempo de conexão expirou!</v-card-title>
                <v-card-text>
                    <p class="text-justify">Reinicie o processo lendo o QRCode novamente.</p>
                    <p class="text-justify">Fique atento à tela do kiosk, caso deseje mais tempo, toque em +1 minuto.
                    </p>
                </v-card-text>
            </v-card>
        </v-dialog>
    </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeMount, onUnmounted, reactive } from "vue";
import { useRoute } from "vue-router";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { UPLOAD_LIMITS, validateSelection } from "../libs/uploadLimits";

import { CONFIRMED_PROTOCOL } from "../libs/confirmedProtocol";
import { ConfirmedSender } from "../libs/confirmedSender";
let activeSender: ConfirmedSender | undefined;

enum FileStatus { "idle", "sending", "done", "error" }
const myID = uuid();

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

const userDialogShow = ref(true);
const user = ref({ email: "", cpf: "", cpf_on_nf: false, accept_terms: false });

const id = ref("");
const identifier = ref("");
const bridgeServerAddress = ref("");
const files = ref([] as File[]);
const showDialog = ref(false);
const showDialogSessionLocked = ref(false);
const showDialogSessionError = ref(false);
const showTimeoutDialog = ref(false);
const concluded = ref(false);
const isSending = ref(false);
const uploadError = ref("");
const transferFailed = ref(false);
const protocolReady = ref(false);
const protocolVersion = ref(0);
const uploadLimits = ref({ ...UPLOAD_LIMITS });
enum WsState { "closed", "connecting", "open" }

const wsRef = ref(null as WebSocket | null);
const wsState = ref(WsState.closed as WsState);
const reconnectTimer = ref(null as number | null);
const remoteStatus = ref(null);

// Configs
//const CHUNK_SIZE = 64 * 1024; // 64KB
const RECONNECT_DELAY_MS = 3000;

const formValid = ref(false)

const emailRules = [
    (v: string) => !!v || 'E-mail é obrigatório',
    (v: string) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'E-mail inválido'
]

const cpfRules = [
    (v: string) => !!v || 'CPF é obrigatório',
    (v: string) => isValidCPF(v) || 'CPF inválido'
]

// Remove tudo que não for número
function onlyNumbers(value: string) {
    return value.replace(/\D/g, '')
}

function isValidCPF(cpf: string): boolean {
    cpf = onlyNumbers(cpf)

    if (cpf.length !== 11) return false
    if (/^(\d)\1{10}$/.test(cpf)) return false // todos iguais

    let sum = 0
    let rest

    for (let i = 1; i <= 9; i++) {
        sum += parseInt(cpf.substring(i - 1, i)) * (11 - i)
    }

    rest = (sum * 10) % 11
    if (rest === 10 || rest === 11) rest = 0
    if (rest !== parseInt(cpf.substring(9, 10))) return false

    sum = 0
    for (let i = 1; i <= 10; i++) {
        sum += parseInt(cpf.substring(i - 1, i)) * (12 - i)
    }

    rest = (sum * 10) % 11
    if (rest === 10 || rest === 11) rest = 0

    return rest === parseInt(cpf.substring(10, 11))
}



onBeforeMount(async () => {
    await connectSession();
});


async function connectSession() {
    const code = (route.params.id as string).toUpperCase();
    axios.get(
        `https://bridge.picjoy.com.br/session/${code.toUpperCase()}/${myID}`,
        {
            headers: { "Content-Type": "application/json" },
            params: { uploadTicket: route.query?.uploadTicket }
        }).then((response) => {
            const session = response.data as {
                inUse: boolean;
                customerId: string;
                bridgeServerAddress: string;
            };

            if (session.inUse && session.customerId !== myID) {
                showDialogSessionLocked.value = true;
                setTimeout(async () => {
                    await connectSession();
                }, RECONNECT_DELAY_MS)
            } else {
                showDialogSessionLocked.value = false;
                identifier.value = code ?? "unknown";
                id.value = code ?? "kiosk-session";
                bridgeServerAddress.value = session.bridgeServerAddress;
                connectWebSocket();
            }

        }).catch(() => {
            userDialogShow.value = false;
            showDialogSessionError.value = true;
            uploadError.value = "Releia o QR Code atual junto ao totem. A permissão pode ter expirado ou já ter sido utilizada.";
        });
}

function sendUserData() {
    if (!wsRef.value || wsState.value !== WsState.open) {
        return;
    }

    const notify = {
        type: "notify",
        toSession: id.value,
        message: "user_data",
        action: "open-darkroom",
        from: `web-${id.value}`,
        data: {
            email: user.value.email,
            cpf: user.value.cpf,
            cpf_on_nf: user.value.cpf_on_nf,
            accept_terms: user.value.accept_terms
        },
    };
    wsRef.value.send(JSON.stringify(notify));
    userDialogShow.value = false;
}

onUnmounted(() => {
    activeSender?.abort();
    if (wsRef.value) {
        (wsRef.value as WebSocket).close();
        wsRef.value = null;
    }
    if (reconnectTimer.value) window.clearTimeout(reconnectTimer.value);
});

const fileList = computed(() =>
    (files.value as File[]).map((f, index) => {
        const idKey = `${index}:${f.name}-${f.size}-${f.lastModified}`;
        const cache = progressCache[idKey];

        return {
            id: idKey,
            file: f,
            name: f.name,
            size: f.size,
            progress: cache ? cache.progress : 0,
            status: cache
                ? cache.status === "sending"
                    ? FileStatus.sending
                    : cache.status === "done"
                        ? FileStatus.done
                        : FileStatus.error
                : FileStatus.idle,
            lastModified: f.lastModified,
        } as FileItem;
    })
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
            protocolReady.value = false;
            wsState.value = WsState.open;
            console.info("WS connected to", url);

            // Register as web client and include target session ID for convenience
            const registerMsg = {
                type: "register",
                role: "web",
                id: myID,
                uploadTicket: route.query?.uploadTicket,
                sessionId: `${id.value}`,
                protocolVersion: CONFIRMED_PROTOCOL,
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
        });

        ws.addEventListener("message", (ev: MessageEvent) => {
            // Normalize payload (could be string or binary)
            let text: string | null = null;

            // Verify Message data
            if (typeof ev.data === "string") {
                text = ev.data;
            } else if (ev.data instanceof ArrayBuffer || ev.data instanceof Uint8Array) {
                text = new TextDecoder("utf-8").decode(ev.data as any);
            } else {
                console.warn("WS received unknown data type", typeof ev.data);
            }


            if (!text) return;

            try {
                const data = JSON.parse(text);
                if (data.type === "registered") {
                    protocolVersion.value = data.protocolVersion === CONFIRMED_PROTOCOL ? CONFIRMED_PROTOCOL : 0;
                    if (!protocolVersion.value) uploadError.value = "O totem precisa ser atualizado para confirmar o recebimento das fotos.";
                    if (protocolVersion.value && data.uploadLimits) {
                        for (const key of Object.keys(UPLOAD_LIMITS) as (keyof typeof UPLOAD_LIMITS)[]) {
                            const limit = data.uploadLimits[key];
                            if (Number.isSafeInteger(limit) && limit > 0) {
                                uploadLimits.value[key] = Math.min(UPLOAD_LIMITS[key], limit);
                            }
                        }
                    }
                    protocolReady.value = true;
                    return;
                }
                if (data.type === "upload-ack") { activeSender?.accept(data); return; }
                if (data.type === "transfer-error") {
                    activeSender?.abort(typeof data.message === "string" ? data.message : undefined);
                    transferFailed.value = true;
                    concluded.value = false;
                    showDialog.value = false;
                    uploadError.value = typeof data.message === "string" ? data.message : "Falha no envio. Reinicie o processo junto ao totem.";
                    if (reconnectTimer.value) window.clearTimeout(reconnectTimer.value);
                    ws.close();
                    return;
                }
                if (data.type === "session-locked") {

                    showDialogSessionLocked.value = true;

                    ws.close();

                    return;
                }
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
                } else if (data.type === "timeout") {
                    console.warn("Kiosk sent timeout message");
                    showTimeoutDialog.value = true;
                } else {
                    // fallback log
                    console.debug("WS message:", data);
                }
            } catch (err) {
                console.error("Failed to parse WS message:", err);
            }
        });

        ws.addEventListener("close", (event: CloseEvent) => {
            console.warn("WS closed");
            activeSender?.abort();
            if (isSending.value && !concluded.value) {
                transferFailed.value = true; uploadError.value ||= "A conexão foi interrompida. Reinicie junto ao totem.";
            }
            wsRef.value = null;
            wsState.value = WsState.closed;
            protocolReady.value = false;
            if (concluded.value && event.wasClean) {
                // Aguarda o fechamento do socket para não interromper dados ainda na fila.
                try {
                    window.close();
                } finally {
                    // Abas abertas por QR Code podem bloquear window.close().
                    if (!window.closed) window.location.replace("https://picjoyclub.com");
                }
            }
            if (protocolVersion.value === CONFIRMED_PROTOCOL && !concluded.value) {
                transferFailed.value = true; uploadError.value ||= "Conexão encerrada. Releia o QR Code junto ao totem.";
            }
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
    if (concluded.value || transferFailed.value) return;
    if (reconnectTimer.value) return;
    reconnectTimer.value = window.setTimeout(() => {
        reconnectTimer.value = null;
        connectWebSocket();
    }, RECONNECT_DELAY_MS);
}

// O sucesso só é anunciado depois do ACK final do Kiosk.
async function sendFiles() {
    if (!canSend.value || !wsRef.value) return;
    uploadError.value = validateSelection(files.value, uploadLimits.value, true);
    if (uploadError.value) return;
    isSending.value = true;
    const list = fileList.value;
    activeSender = new ConfirmedSender(wsRef.value, uuid);
    try {
        await activeSender.send(files.value, (index, progress, done) => {
            progressCache[list[index]!.id] = { progress, status: done ? "done" : "sending" };
        });
        if (transferFailed.value) throw new Error("Envio interrompido.");
        concluded.value = true;
        showDialog.value = true;
        if (reconnectTimer.value) window.clearTimeout(reconnectTimer.value);
        wsRef.value?.close();
    } catch (error) {
        transferFailed.value = true;
        uploadError.value ||= error instanceof Error ? error.message : "Falha no envio. Reinicie junto ao totem.";
        showDialog.value = false;
        for (const item of list) {
            if (progressCache[item.id]?.status !== "done") progressCache[item.id] = { progress: 0, status: "error" };
        }
        wsRef.value?.close();
    } finally { isSending.value = false; activeSender = undefined; }
}

// Progress cache used by template via fileListProgress helper
const progressCache = reactive<Record<string, { progress: number; status: string }>>({});

// Helpers for template binding
const awaitingPreparation = computed(() => isSending.value && files.value.length > 0
    && fileList.value.every(file => file.status === FileStatus.done));
const canSend = computed(() => files.value.length > 0 && wsState.value === WsState.open
    && protocolReady.value && protocolVersion.value === CONFIRMED_PROTOCOL && !isSending.value && !concluded.value && !transferFailed.value);
const fileInputRef = ref<any>(null);

function openFileSelector() {
    const input = fileInputRef.value?.$el?.querySelector('input[type="file"]');

    if (input) {
        input.click();
    }
}
</script>

<style scoped>
/* Pequeno ajuste de espaçamento */
.v-card-text p {
    margin: 0.25rem 0;
}

.file-input-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
}
</style>
