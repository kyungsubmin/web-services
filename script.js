// Morning Music Alarm App - Core Logic

let wakeLock = null;
let player = null;
let isPlayerReady = false;

// State management
let alarmState = {
    selectedVideo: null,
    hasPreparedToday: false,
    hasRungToday: false,
    lastTriggerDate: null
};

document.addEventListener('DOMContentLoaded', () => {
    initClock();
    loadSettings();
    setupEventListeners();
    
    // Load YouTube API asynchronously
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    
    // Check alarm every second
    setInterval(checkAlarmLoop, 1000);
});

// YouTube API callback
window.onYouTubeIframeAPIReady = function() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            'playsinline': 1,
            'controls': 1,
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    isPlayerReady = true;
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.ENDED) {
        // Music ended
        setTimeout(() => {
            speakMessage("오늘도 좋은 하루 보내세요!", () => {
                // Done playing today
                document.getElementById('youtube-player-container').classList.add('hidden');
                saveToHistory(alarmState.selectedVideo);
            });
        }, 5000);
    }
}

function initClock() {
    const timeEl = document.getElementById('current-time');
    const dateEl = document.getElementById('current-date');

    function updateClock() {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit' });
        dateEl.textContent = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
        requestAnimationFrame(updateClock);
    }
    updateClock();
}

function loadSettings() {
    const savedTime = localStorage.getItem('alarmTime');
    let savedKey = localStorage.getItem('youtubeApiKey');
    
    if (!savedKey) {
        // 채팅창으로 전달해주신 기본 API Key 자동 등록
        savedKey = 'AIzaSyD8UlSi-5xFDjgBmF0tcqMKxIrHHObNJ3o';
        localStorage.setItem('youtubeApiKey', savedKey);
    }
    
    if (savedTime) document.getElementById('alarm-time-input').value = savedTime;
    if (savedKey) document.getElementById('api-key-input').value = savedKey;
    renderHistory();
}

function setupEventListeners() {
    document.getElementById('save-alarm-btn').addEventListener('click', saveAlarm);
    document.getElementById('save-api-key-btn').addEventListener('click', saveApiKey);
}

// Wake Lock
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            document.getElementById('wake-lock-status').classList.remove('hidden');
            wakeLock.addEventListener('release', () => {
                document.getElementById('wake-lock-status').classList.add('hidden');
            });
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function saveAlarm() {
    const timeStr = document.getElementById('alarm-time-input').value;
    if (!timeStr) {
        showStatus('시간을 선택해주세요.', 'warning');
        return;
    }
    localStorage.setItem('alarmTime', timeStr);
    
    // Reset state for new alarm evaluation
    alarmState.hasPreparedToday = false;
    alarmState.hasRungToday = false;
    // We do NOT reset lastTriggerDate here to avoid re-triggering if they save the same time slightly after it rings... 
    // Wait, it's safer to just let the loop handle it.
    
    showStatus(`알람이 ${timeStr}로 설정되었습니다. 화면 유지가 활성화되었습니다.`, 'success');
    requestWakeLock();
    resumeAudioContext(); // Audio/Speech warmup
}

function saveApiKey() {
    const key = document.getElementById('api-key-input').value;
    if (!key) {
        alert('API Key를 입력해주세요.');
        return;
    }
    localStorage.setItem('youtubeApiKey', key);
    alert('API Key가 저장되었습니다.');
}

function showStatus(msg, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.innerHTML = msg; 
    statusEl.className = `status-msg ${type}`;
    statusEl.classList.remove('hidden');
    setTimeout(() => { if(!statusEl.innerHTML.includes('필요')) statusEl.classList.add('hidden'); }, 5000);
}

// core alarm loop
async function checkAlarmLoop() {
    const alarmTimeStr = localStorage.getItem('alarmTime');
    const apiKey = localStorage.getItem('youtubeApiKey');
    
    if (!alarmTimeStr) return;
    
    const now = new Date();
    const todayDateStr = now.toLocaleDateString();
    
    // Reset daily state if it's a new day
    if (alarmState.lastTriggerDate && alarmState.lastTriggerDate !== todayDateStr) {
        alarmState.hasPreparedToday = false;
        alarmState.hasRungToday = false;
        alarmState.selectedVideo = null;
    }

    const [alarmHour, alarmMinute] = alarmTimeStr.split(':').map(Number);
    const alarmTime = new Date(now);
    alarmTime.setHours(alarmHour, alarmMinute, 0, 0);
    
    const diffMs = alarmTime.getTime() - now.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    // 1. Prepare music 5 mins earlier (between 5 down to 0 mins before alarm)
    if (diffMinutes > 0 && diffMinutes <= 5 && !alarmState.hasPreparedToday) {
        alarmState.hasPreparedToday = true; // Mark as done for today
        if (apiKey) {
            await prepareMusic(apiKey);
        } else {
            console.log("No API key, will use fallback video");
            alarmState.selectedVideo = {
                videoId: "5qap5aO4i9A", // chill lofi as fallback
                title: "lofi hip hop radio - beats to relax/study to",
                thumbnail: ""
            };
        }
    }
    
    // 2. Trigger alarm at exact time (diff <= 0) but only once a day!
    // We allow a small window up to 2 mins after the alarm time in case of delays
    if (diffMinutes <= 0 && diffMinutes > -2 && !alarmState.hasRungToday) {
        alarmState.hasRungToday = true;
        alarmState.lastTriggerDate = todayDateStr; // Record the day it rang
        
        // If preparation failed or hasn't run (e.g. app opened exactly at alarm time), use fallback
        if (!alarmState.selectedVideo) {
             alarmState.selectedVideo = {
                videoId: "5qap5aO4i9A", 
                title: "lofi hip hop radio - beats to relax/study to (Fallback)"
            };
        }
        
        triggerAlarmSequence();
    }
}

async function prepareMusic(apiKey) {
    try {
        const query = encodeURIComponent("차분한 아침 음악 연주");
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&videoDuration=medium&maxResults=20&key=${apiKey}`);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
            // Pick a random video from top 20
            const randomItem = data.items[Math.floor(Math.random() * data.items.length)];
            alarmState.selectedVideo = {
                videoId: randomItem.id.videoId,
                title: randomItem.snippet.title,
                thumbnail: randomItem.snippet.thumbnails.default ? randomItem.snippet.thumbnails.default.url : ''
            };
            console.log("Prepared video:", alarmState.selectedVideo);
        } else {
             throw new Error("No videos found by YT API");
        }
    } catch (err) {
        console.error("Failed to fetch YT API", err);
    }
}

function triggerAlarmSequence() {
    speakMessage("좋은 아침입니다. 오늘의 음악 들려 드리겠습니다.", () => {
        setTimeout(() => {
            playSelectedVideo();
        }, 5000);
    });
}

function playSelectedVideo() {
    if (isPlayerReady && alarmState.selectedVideo) {
        const pContainer = document.getElementById('youtube-player-container');
        pContainer.classList.remove('hidden');
        pContainer.scrollIntoView({ behavior: 'smooth' });
        
        player.loadVideoById(alarmState.selectedVideo.videoId);
    } else {
        console.warn('Player not ready or video not selected, retrying in 1s...');
        setTimeout(playSelectedVideo, 1000);
    }
}

function speakMessage(text, onEndCallback) {
    if (!('speechSynthesis' in window)) {
        if(onEndCallback) onEndCallback();
        return;
    }
    
    speechSynthesis.cancel(); // Cancel any ongoing speech
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    
    let isCallbackCalled = false;
    utterance.onend = () => {
        if (!isCallbackCalled) {
            isCallbackCalled = true;
            if(onEndCallback) onEndCallback();
        }
    };
    
    // Fallback if onend never fires (Safari issue)
    setTimeout(() => {
        if (!isCallbackCalled) {
            isCallbackCalled = true;
            if(onEndCallback) onEndCallback();
        }
    }, 8000); 
    
    speechSynthesis.speak(utterance);
}

function saveToHistory(video) {
    if(!video) return;
    const history = JSON.parse(localStorage.getItem('playHistory') || '[]');
    history.unshift({
        date: new Date().toISOString(),
        videoId: video.videoId,
        title: video.title,
        thumbnail: video.thumbnail
    });
    localStorage.setItem('playHistory', JSON.stringify(history.slice(0, 30)));
    renderHistory();
}

function renderHistory() {
    const history = JSON.parse(localStorage.getItem('playHistory') || '[]');
    const listEl = document.getElementById('history-list');
    
    if (history.length === 0) {
        listEl.innerHTML = '<li class="history-item">아직 재생 기록이 없습니다.</li>';
        return;
    }
    
    listEl.innerHTML = history.slice(0, 5).map(item => `
        <li class="history-item">
            ${item.thumbnail ? `<img src="${item.thumbnail}" alt="thumbnail">` : ''}
            <div>
                <a href="https://youtu.be/${item.videoId}" target="_blank" style="color:var(--text-primary); text-decoration:none;">
                    <strong>${item.title}</strong>
                </a>
                <br>
                <small style="color:var(--text-secondary)">${new Date(item.date).toLocaleDateString()}</small>
            </div>
        </li>
    `).join('');
}

function resumeAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
        const ctx = new AudioContext();
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
    }
    const utterance = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(utterance);
}
