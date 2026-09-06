const stage_preconnect = document.getElementById('stage_preconnect');
const stage_connecting = document.getElementById('stage_connecting');
const stage_connected = document.getElementById('stage_connected');
const stage_finished = document.getElementById('stage_finished');
const wait_msg = document.getElementById('wait_msg');
const connecting_msg = document.getElementById('connecting_msg');
const download_progress = document.getElementById('download_progress');
const download_progress_bar = document.getElementById('download_progress_bar');
const download_progress_text = document.getElementById('download_progress_text');

const video_elem = document.getElementById('media');

let ws;
let round_trip_time = 0;
let is_ready = false;
let should_be_playing = false;
let media_loaded = false;
let reconnectTimer = null;
let reconnectDelay = 1000; 

function connect() {
    stage_preconnect.classList.add('hidden');
    stage_connecting.classList.remove('hidden');

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const adress = `${protocol}//${location.host}/ws`;
    console.log(`Connecting to ${adress}...`);
    ws = new WebSocket(adress);
    ws.onopen = () => {
        console.log("Connected!");
        connecting_msg.innerHTML = "Connected! Downloading video...";
        ws.send(JSON.stringify({ type: "register-client", t0: Date.now() }));
        load_media();
    };
    ws.onclose = () => {
        console.log("Disconnected!");
        wait_msg.innerHTML = "Disconnected from server. Reconnecting...";
        scheduleReconnect();
    };
    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        ws.close();
    };

    listen_to_server(ws);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);

  reconnectTimer = setTimeout(() => {
    connect();

    // Exponential backoff
    reconnectDelay = Math.min(
      reconnectDelay * 2,
      30000
    );
  }, reconnectDelay);
}

function video_is_loaded() {
    return !!video_elem && video_elem.readyState >= 2 && !!video_elem.src;
}

async function load_media() {
    if (media_loaded || video_is_loaded()) {
        ready();
        return;
    }

    try {
        const response = await fetch(`dl-media-file?download=${Date.now()}`);
        if (!response.ok || !response.body) {
            throw new Error(`Unable to download video: ${response.status}`);
        }

        const content_length = Number(response.headers.get('content-length'));
        const reader = response.body.getReader();
        const chunks = [];
        let downloaded_bytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            chunks.push(value);
            downloaded_bytes += value.length;
            if (content_length) {
                const percentage = Math.round((downloaded_bytes / content_length) * 100);
                download_progress_bar.value = percentage;
                download_progress_text.textContent = `${percentage}%`;
            }
        }

        const video_blob = new Blob(chunks, {
            type: response.headers.get('content-type') || 'video/webm'
        });
        video_elem.addEventListener('loadeddata', ready, { once: true });
        video_elem.src = URL.createObjectURL(video_blob);
        video_elem.load();
        download_progress_bar.value = 100;
        download_progress_text.textContent = '100%';
        download_progress.classList.add('hidden');
    } catch (error) {
        console.error(error);
        connecting_msg.textContent = 'Unable to download video.';
    }
}

function ready() {
    media_loaded = true;
    stage_connecting.classList.add('hidden');
    stage_connected.classList.remove('hidden');
    wait_msg.innerHTML = "Waiting for host to start the video...";
    enableSound();
    ws.send(JSON.stringify({ type: "ready" }));
    is_ready = true;
}

function playAt(video_time, server_time) {
    if (!is_ready) return;
    should_be_playing = true;
    const target_position = video_time + round_trip_time / 2000;

    if (target_position >= video_elem.duration) {
        should_be_playing = false;
        video_elem.pause();
        stage_connected.classList.add('hidden');
        stage_finished.classList.remove('hidden');
        exitFullscreen();
        return;
    }

    const drift = target_position - video_elem.currentTime;
    //console.log(`Target: ${target_position.toFixed(3)}s, Current: ${video_elem.currentTime.toFixed(3)}s, Drift: ${drift.toFixed(3)}s, Server clock offset: ${(round_trip_time / 2000).toFixed(3)}s`);
    if (Math.abs(drift) >= 1) {
        video_elem.currentTime = target_position;
        video_elem.playbackRate = 1.0;
    } else if (Math.abs(drift) >= 0.01) {
        video_elem.playbackRate = Math.pow(1.2, drift);
    } else {
        video_elem.playbackRate = 1.0;
    }
    for (const elem of [stage_preconnect, stage_connecting, stage_finished]) {
        elem.classList.add('hidden');
    }
    stage_connected.classList.remove('hidden');
    wait_msg.classList.add('hidden');

    if (video_elem.paused) {
        video_elem.play().catch((error) => {
            console.error("Error while trying to play the video:", error);
        });
    }
}

function fullscreen() {
    if (!video_elem) {
        return;
    }

    const methods = [
        'requestFullscreen',
        'webkitRequestFullscreen',
        'mozRequestFullScreen',
        'msRequestFullscreen',
        'webkitEnterFullscreen'
    ];

    for (const method of methods) {
        if (typeof video_elem[method] === 'function') {
            video_elem[method].call(video_elem);
            if (!should_be_playing) {
                video_elem.pause();
            }
            return;
        }
    }
}

function exitFullscreen() {
    const fullscreen_element = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement;

    if (!fullscreen_element) {
        return;
    }

    const methods = [
        'exitFullscreen',
        'webkitExitFullscreen',
        'mozCancelFullScreen',
        'msExitFullscreen',
        'webkitEnterFullscreen'
    ];

    for (const method of methods) {
        if (typeof document[method] === 'function') {
            document[method].call(document);
            return;
        }
    }
}

function enableSound() {
    video_elem.muted = false;
    video_elem.volume = 1;
}

function listen_to_server(ws) {
    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === "pong") {
            round_trip_time = Date.now() - data.clientTime;
        }
        if (data.type === "play") {
            should_be_playing = true;
            //console.log("START:", data.server_time, data.video_time);
            playAt(data.video_time, data.server_time);
        }
        if (data.type === "pause") {
            should_be_playing = false;
            //console.log("PAUSE!")
            if (video_elem) {
                video_elem.pause();
                wait_msg.classList.remove('hidden');
            };
        }
    };
}