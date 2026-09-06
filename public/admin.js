let ws;
let reconnectController = null;
let adminPassword = null;

const btn_connect = document.getElementById("btn_connect")
const content = document.getElementById("admin_content")
const toggle = document.getElementById("status_icon")
// const file_input = document.getElementById("file_picker")

function should_attempt_reconnect() {
    return !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
}

if (!reconnectController) {
    reconnectController = window.ReconnectController.create({
        onReconnect: connect,
        shouldReconnect: should_attempt_reconnect
    });
}

async function connect() {
    if (!adminPassword) {
        adminPassword = window.prompt("Admin password:");
    }

    if (adminPassword === null || adminPassword === "") {
        return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
        console.log("Connected!")
        reconnectController.resetDelay();
        toggle.innerHTML = "▶"
        ws.send(JSON.stringify({ type: "authenticate", password: adminPassword }));
    }

    ws.onclose = () => {
        console.log("Disconnected!")
        reconnectController.scheduleReconnect();
    }

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data)
        if (data.type === "authentication") {
            if (!data.authenticated) {
                alert("Authentication failed");
                adminPassword = null;
                ws.close();
                return;
            }

            btn_connect.style.display = "none";
            content.classList.remove("hidden");
            ws.send(JSON.stringify({ type: "register-admin" }));
        }
        if (data.type === "start") {
            console.log("Start");
            toggle.innerHTML = "⏸";
        }
        if (data.type === "pause") {
            console.log("Pause");
            toggle.innerHTML = "▶";
        }
        if (data.type === "num_clients") {
            document.getElementById("num-clients").innerHTML = data.num_clients;
        }
        if (data.type === "num_ready") {
            document.getElementById("num-ready").innerHTML = data.num_ready;
        }
    }
}

async function toggleAudio() {
    console.log("Toggle")
    ws.send(JSON.stringify({type: "toggle"}))
}

// async function uploadFile() {
//     const file = file_input.files[0];

//     if (!file) {
//         alert("Choose a file first");
//         return;
//     }

//     const formData = new FormData();
//     formData.append("file", file);
    
//     file_input.files = [];

//     const response = await fetch("/upload", {
//         method: "POST",
//         body: formData
//     });

//     const result = await response.json();

//     console.log(result);

//     alert("Successfully uploaded file!")
// }