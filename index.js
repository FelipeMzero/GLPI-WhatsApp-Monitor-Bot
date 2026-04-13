require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const GLPIClient = require('./glpi');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL = (parseInt(process.env.POLLING_INTERVAL) || 5) * 1000;
const STATE_FILE = path.join(__dirname, 'state.json');

// Initialize GLPI Client
const glpi = new GLPIClient(
    process.env.GLPI_URL,
    process.env.GLPI_APP_TOKEN,
    process.env.GLPI_USER_TOKEN
);

// WhatsApp Client Setup
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './sessions' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Configuration Management
const CONFIG_FILE = path.join(__dirname, 'config.json');
let appConfig = {
    GLPI_URL: process.env.GLPI_URL || '',
    WHATSAPP_TARGET: process.env.WHATSAPP_TARGET || '',
    POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 3,
    PORT: parseInt(process.env.PORT) || 3000
};

// Load persistent config if exists
if (fs.existsSync(CONFIG_FILE)) {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE));
        appConfig = { ...appConfig, ...saved };
    } catch (e) {}
}

const saveConfig = (newConfig) => {
    appConfig = { ...appConfig, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2));
    // Update interval if changed
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = setInterval(pollGLPITickets, appConfig.POLLING_INTERVAL * 1000);
    }
};

let systemState = {
    whatsapp: 'offline',
    ticketStatuses: {}, // id -> status
    resolvedTarget: null // Cached Group or User ID
};

// Load last processed state
if (fs.existsSync(STATE_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(STATE_FILE));
        systemState.ticketStatuses = data.ticketStatuses || {};
    } catch (e) {
        systemState.ticketStatuses = {};
    }
}

function saveState() {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ticketStatuses: systemState.ticketStatuses }));
}

function broadcastLog(message, type = 'info') {
    const log = { message, type, time: new Date() };
    io.emit('log', log);
    console.log(`[${type.toUpperCase()}] ${message}`);
}

const qrt = require('qrcode-terminal');
const he = require('he');

// WhatsApp Events
client.on('qr', (qr) => {
    systemState.whatsapp = 'waiting';
    qrcode.toDataURL(qr, (err, url) => {
        io.emit('qr', url);
    });
    // Fallback: Terminal QR for speed
    qrt.generate(qr, { small: true });
    broadcastLog('QR Code recebido. Escaneie pelo terminal ou pela página web.', 'warning');
});

client.on('ready', async () => {
    systemState.whatsapp = 'online';
    io.emit('ready');
    broadcastLog('WhatsApp conectado com sucesso!', 'success');
    
    // Resolve Target (Group or User)
    const rawTarget = appConfig.WHATSAPP_TARGET;
    let targetId = null;

    if (rawTarget.includes('@')) {
        targetId = rawTarget;
    } else {
        try {
            broadcastLog(`Buscando destino: ${rawTarget}...`, 'info');
            const chats = await client.getChats();
            
            // Search by group name
            const group = chats.find(c => c.isGroup && c.name === rawTarget);
            if (group) {
                targetId = group.id._serialized;
                broadcastLog(`Grupo encontrado: ${group.name} (${targetId})`, 'success');
            } else {
                // Fallback to number ONLY if it looks like one
                if (/^\+?\d+$/.test(rawTarget.replace(/\s/g, ''))) {
                    const contactId = await client.getNumberId(rawTarget);
                    targetId = contactId ? contactId._serialized : rawTarget.replace(/\D/g, '') + '@c.us';
                    broadcastLog(`Usando número direto: ${targetId}`, 'info');
                } else {
                    broadcastLog(`Destino "${rawTarget}" não encontrado como grupo e não parece um número válido.`, 'error');
                }
            }
        } catch (err) {
            broadcastLog('Erro ao buscar destino: ' + err.message, 'error');
        }
    }
    
    if (!targetId) {
        broadcastLog('Aguardando configuração de destino válida...', 'warning');
        return;
    }
    
    systemState.resolvedTarget = targetId;
    
    try {
        await client.sendMessage(targetId, '*🤖 GLPI Monitor*\nInstância iniciada. Monitorando chamados do sistema agora.');
        broadcastLog(`Sistema pronto e notificado no chat: ${targetId}`, 'success');
    } catch (e) {
        broadcastLog('Erro ao enviar mensagem de ativação: ' + e.message, 'error');
    }

    // Start Polling 
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = setInterval(pollGLPITickets, appConfig.POLLING_INTERVAL * 1000);
});

// Global Error Handlers to keep app alive
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

client.on('authenticated', () => {
    broadcastLog('Autenticado no WhatsApp.', 'success');
});

client.on('auth_failure', (msg) => {
    systemState.whatsapp = 'offline';
    io.emit('disconnected');
    broadcastLog('Falha na autenticação: ' + msg, 'error');
});

client.on('disconnected', (reason) => {
    systemState.whatsapp = 'offline';
    io.emit('disconnected');
    broadcastLog('WhatsApp desconectado: ' + reason, 'error');
});

// GLPI Polling Logic
async function pollGLPITickets() {
    if (systemState.whatsapp !== 'online') return;

    broadcastLog('Escaneando GLPI por novos eventos...', 'info');
    
    const tickets = await glpi.getTickets();
    if (!tickets || !Array.isArray(tickets)) return;

    const SOLVED_STATUS = [5, 6]; // Solved or Closed
    const isFirstRun = Object.keys(systemState.ticketStatuses).length === 0;

    for (const ticket of tickets) {
        const ticketId = ticket.id;
        const currentStatus = ticket.status;
        const lastStatus = systemState.ticketStatuses[ticketId];

        const isNew = lastStatus === undefined && !isFirstRun;
        const isNowSolved = SOLVED_STATUS.includes(currentStatus) && (lastStatus !== undefined && !SOLVED_STATUS.includes(lastStatus));

        // If it's the first run, we just populate the map without sending notifications
        if (isFirstRun) {
            systemState.ticketStatuses[ticketId] = currentStatus;
            continue;
        }

        if (isNew || isNowSolved) {
            broadcastLog(`Evento detectado no chamado #${ticketId} (Status: ${currentStatus})`, 'info');
            
            const details = await glpi.getTicketDetails(ticketId);
            if (!details) continue;

            // Use the resolved target determined at startup
            const target = systemState.resolvedTarget;
            if (!target) continue;

            let message = '';

            if (isNowSolved) {
                const techName = await glpi.getTechnicianName(ticketId);
                const statusLabel = currentStatus === 5 ? 'SOLUCIONADO' : 'FECHADO';
                message = `*✅ CHAMADO FINALIZADO*\n\n` +
                          `*ID:* #${details.id}\n` +
                          `*Assunto:* ${details.name}\n` +
                          `*Status:* ${statusLabel}\n` +
                          `*Finalizado por:* ${techName}`;
            } else if (isNew) {
                const requestor = await glpi.getRequestorName(ticketId);
                const category = details.itilcategories_id || details.itilcategory_name || 'Geral';
                const location = details.locations_id || details.location_name || 'Não informada';
                const rawDescription = details.content || '';
                const decodedDescription = he.decode(rawDescription);
                const cleanDescription = decodedDescription.replace(/<[^>]*>?/gm, ' ').trim().substring(0, 500);

                message = `*🎫 NOVO CHAMADO DETECTADO*\n\n` +
                          `*ID:* #${details.id}\n` +
                          `*Assunto:* ${details.name}\n` +
                          `*Categoria:* ${category}\n` +
                          `*Localização:* ${location}\n` +
                          (requestor !== 'Não identificado' ? `*Requisitante:* ${requestor}\n` : '') +
                          `*Descrição:* ${cleanDescription}${decodedDescription.length > 500 ? '...' : ''}`;
            }

            if (message) {
                try {
                    await client.sendMessage(target, message);
                    broadcastLog(`Notificação do chamado #${ticketId} enviada para ${target}.`, 'success');
                    systemState.ticketStatuses[ticketId] = currentStatus;
                    saveState();
                } catch (e) {
                    broadcastLog(`Erro ao notificar chamado #${ticketId}: ` + e.message, 'error');
                }
            }
        } else {
            // Update status even if no notification sent (to track changes)
            systemState.ticketStatuses[ticketId] = currentStatus;
        }
    }
    
    if (isFirstRun) {
        saveState();
        broadcastLog(`${Object.keys(systemState.ticketStatuses).length} chamados indexados para monitoramento.`, 'info');
    }
}

// Start polling
setInterval(pollGLPITickets, POLL_INTERVAL);

// API/Web Routes
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    socket.emit('status', {
        state: systemState.whatsapp,
        polling: appConfig.POLLING_INTERVAL,
        target: appConfig.WHATSAPP_TARGET,
        url: appConfig.GLPI_URL
    });

    socket.on('saveSettings', (data) => {
        broadcastLog('Novas configurações recebidas.', 'info');
        saveConfig(data);
        // Force re-resolve target next time or now
        if (systemState.whatsapp === 'online') {
            // Re-run the target resolution part of ready
            client.emit('ready'); 
        }
        socket.emit('status', {
            state: systemState.whatsapp,
            polling: appConfig.POLLING_INTERVAL,
            target: appConfig.WHATSAPP_TARGET,
            url: appConfig.GLPI_URL
        });
    });

    socket.on('logout', async () => {
        broadcastLog('Solicitação de desconexão e limpeza recebida.', 'warning');
        try {
            // Logout from WhatsApp (closes browser)
            await client.logout();
            broadcastLog('WhatsApp desconectado.', 'info');

            // Force clean sessions folder
            const sessionPath = path.join(__dirname, 'sessions');
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                broadcastLog('Dados da instância removidos permanentemente.', 'success');
            }

            // Re-initialize for new QR
            setTimeout(() => client.initialize(), 2000);
        } catch (e) {
            broadcastLog('Erro ao desconectar e limpar: ' + e.message, 'error');
            // Even if logout fails, try to wipe the folder and re-init
            try {
                const sessionPath = path.join(__dirname, 'sessions');
                if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
                client.initialize();
            } catch (inner) {}
        }
    });
});

const PORT = appConfig.PORT;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    client.initialize();
});
