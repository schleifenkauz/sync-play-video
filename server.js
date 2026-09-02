const express = require("express");
const http = require("http");
const os = require("os")
const WebSocket = require("ws");
const multer = require("multer");
const dotenv = require("dotenv")
const { S3Client, PutObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const upload = multer({
    storage: multer.memoryStorage()
});

let clients = [];
let ready_clients = [];
let admins = [];

let playing = false;
let play_interval = null;
let playback_start_time = 0;

function send_play_message() {
    const server_time = Date.now();
    const video_time = Math.max(0, (server_time - playback_start_time) / 1000);
    const msg = JSON.stringify({ type: "play", server_time, video_time });
    clients.forEach(ws => ws.send(msg));
}

wss.on("connection", (ws) => {
    ws.on("close", () => {
        clients = clients.filter(client => client !== ws);
        admins = admins.filter(admin => admin !== ws);
        ready_clients = ready_clients.filter(client => client !== ws);

        admins.forEach(adminWs => adminWs.send(JSON.stringify({ type: "num_clients", num_clients: clients.length })));
        admins.forEach(adminWs => adminWs.send(JSON.stringify({ type: "num_ready", num_ready: ready_clients.length })));
    });

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        // Clock sync
        if (data.type === "ping") {

            ws.send(JSON.stringify({
                type: "pong",
                clientTime: data.t0,
                serverTime: Date.now()
            }));
        }

        if (data.type === "toggle") {
            if (!playing) {
                playback_start_time = Date.now() + 2000;
                send_play_message();
                play_interval = setInterval(send_play_message, 1000);
                admins.forEach(ws => ws.send(JSON.stringify({ type: "start" })));
            } else {
                const msg = JSON.stringify({ type: "pause" });
                clearInterval(play_interval);
                clients.forEach(ws => ws.send(msg));
                admins.forEach(ws => ws.send(msg));
                play_interval = null;
            }
            playing = !playing;
        }

        if (data.type === "register-admin") {
            console.log("Registered admin");
            admins.push(ws);
            ws.send(JSON.stringify({ type: "num_clients", num_clients: clients.length }));
            ws.send(JSON.stringify({ type: "num_ready", num_ready: ready_clients.length }));
            if (playing) {
                ws.send(JSON.stringify({ type: "start" }));
            }
        }

        if (data.type === "register-client") {
            console.log("Registered client");
            clients.push(ws);
            ws.send(JSON.stringify({
                type: "pong",
                clientTime: data.t0,
                serverTime: Date.now()
            }));
            admins.forEach(ws => ws.send(JSON.stringify({ type: "num_clients", num_clients: clients.length })));
        }

        if (data.type === "ready") {
            console.log("Client ready");
            if (!ready_clients.includes(ws)) {
                ready_clients.push(ws);
            }
            const num_ready = ready_clients.length;
            admins.forEach(ws => ws.send(JSON.stringify({ type: "num_ready", num_ready })));
        }
    });
});

dotenv.config()

const r2 = new S3Client({
    region: "auto",
    endpoint:
        `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
});

app.post("/upload", upload.single("file"), async (req, res) => {

    const file = req.file;

    if (!file) return res.status(400).json({ message: 'no file' });

    await r2.send(
        new PutObjectCommand({
            Bucket: "sync-play",
            Key: file.originalname,
            Body: file.buffer,
            ContentType: file.mimetype
        })
    );

    res.json({
        message: "uploaded",
        file: file.originalname
    });
});

async function get_all_keys(prefix = "", postfix = "") {
    const result_list = await r2.send(
        new ListObjectsV2Command({
            Bucket: "sync-play",
            Prefix: prefix
        })
    );
    return (result_list.Contents || []).map(obj => obj.Key).filter(key => key.endsWith(postfix));
}

app.get("/available-files", async (req, res) => {
    const keys = await get_all_keys("bach-club", ".mov");
    res.json(keys);
})

var idx = 0;

app.get("/dl-media-file", async (req, res) => {
    const domain = process.env.R2_PUBLIC_DOMAIN;
    const keys = await get_all_keys("bach-club", ".mov");
    const key = keys[idx % keys.length];
    console.log("Selected ", key);
    const url = `${domain}/${key}`
    res.redirect(url);
});

function getLocalIP() {
    const nets = os.networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {

            if (
                net.family === "IPv4" &&
                !net.internal &&
                !name.includes("Virtual") &&
                !name.includes("Docker")
            ) {
                return net.address;
            }
        }
    }
}

const port = process.env.PORT || 8081;
server.listen(port, "0.0.0.0", () => {
    const ip = getLocalIP();
    const url = `http://${ip}:${port}`;
    console.log("Client Adresse: ", url);
});

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}