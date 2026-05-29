"use strict";

(function bootLooper() {
  const Domain = window.AudioLibraryDomain;
  const STORAGE_KEY = "looper-library:v1";
  const LEGACY_KEYS = ["tiktok-audio-library:v3", "tiktok-audio-library:v2"];
  const DB_NAME = "tiktok-audio-library";
  const DB_VERSION = 1;
  const STORE_NAME = "audioFiles";
  const DEFAULT_THUMBNAIL = "assets/poster-wave.svg";
  const SHARE_KIND = "looper-share";
  const LEGACY_SHARE_KIND = "audio-library-share";
  const AUTO_VIDEO_TRIM_SEC = 4;

  const els = {
    audioList: document.querySelector("#audioList"),
    importForm: document.querySelector("#importForm"),
    importPreview: document.querySelector("#importPreview"),
    importPreviewThumb: document.querySelector("#importPreviewThumb"),
    importPreviewTitle: document.querySelector("#importPreviewTitle"),
    likedCount: document.querySelector("#likedCount"),
    mainAudio: document.querySelector("#mainAudio"),
    nowPlayingBar: document.querySelector("#nowPlayingBar"),
    nowSubtitle: document.querySelector("#nowSubtitle"),
    nowTitle: document.querySelector("#nowTitle"),
    originalDuration: document.querySelector("#originalDuration"),
    playlistCount: document.querySelector("#playlistCount"),
    playlistFilter: document.querySelector("#playlistFilter"),
    playlistForm: document.querySelector("#playlistForm"),
    previewAudio: document.querySelector("#previewAudio"),
    queueCount: document.querySelector("#queueCount"),
    queuePanel: document.querySelector(".queue-panel"),
    searchInput: document.querySelector("#searchInput"),
    sharePlaylistSelect: document.querySelector("#sharePlaylistSelect"),
    sharePreview: document.querySelector("#sharePreview"),
    sharePreviewMeta: document.querySelector("#sharePreviewMeta"),
    sharePreviewThumb: document.querySelector("#sharePreviewThumb"),
    sharePreviewTitle: document.querySelector("#sharePreviewTitle"),
    soundCount: document.querySelector("#soundCount"),
    statusText: document.querySelector("#statusText"),
    trimEndRange: document.querySelector("#trimEndRange"),
    trimmedDuration: document.querySelector("#trimmedDuration"),
    trimStartRange: document.querySelector("#trimStartRange"),
    viewButtons: Array.from(document.querySelectorAll("[data-view]")),
    waveformCanvas: document.querySelector("#waveformCanvas")
  };

  let state = loadState();
  let dbPromise = null;
  let activeAudioUrl = null;
  let activePreviewUrl = null;
  let importPreview = null;
  let sharePreview = null;
  let loopStartedAt = null;
  let advancingTrack = false;

  function defaultState() {
    return {
      editingId: null,
      playingId: null,
      queueIds: [],
      repeatMode: "none",
      selectedPlaylistId: "",
      selectedView: "sounds",
      searchQuery: "",
      shuffleEnabled: false,
      playlists: [],
      audios: []
    };
  }

  function loadState() {
    const stateFromStorage = readSavedState(STORAGE_KEY) || LEGACY_KEYS.map(readSavedState).find(Boolean);
    const next = normalizeState(stateFromStorage || defaultState());
    next.playingId = null;
    return next;
  }

  function readSavedState(key) {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeState(rawState) {
    const next = { ...defaultState(), ...rawState };
    next.selectedView = ["sounds", "liked", "playlists", "trending", "top"].includes(next.selectedView)
      ? next.selectedView
      : "sounds";
    next.repeatMode = ["none", "sound", "playlist"].includes(next.repeatMode) ? next.repeatMode : "none";
    next.searchQuery = String(next.searchQuery || "");
    next.shuffleEnabled = Boolean(next.shuffleEnabled);
    next.playlists = Array.isArray(next.playlists) ? next.playlists.map(ensurePlaylistDefaults) : [];
    next.audios = Array.isArray(next.audios) ? next.audios.map(ensureAudioDefaults) : [];
    next.queueIds = Array.isArray(next.queueIds)
      ? next.queueIds.filter((id) => next.audios.some((audio) => audio.id === id))
      : [];
    if (!next.playlists.some((playlist) => playlist.id === next.selectedPlaylistId)) {
      next.selectedPlaylistId = "";
    }
    if (!next.audios.some((audio) => audio.id === next.editingId)) {
      next.editingId = null;
    }
    if (!next.audios.some((audio) => audio.id === next.playingId)) {
      next.playingId = null;
    }
    return next;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  async function putAudioBlob(id, blob) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAudioBlob(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteAudioBlob(id) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function setStatus(message) {
    els.statusText.textContent = message;
  }

  function cleanTitle(fileName) {
    return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Imported sound";
  }

  function ensurePlaylistDefaults(playlist) {
    const now = new Date().toISOString();
    return {
      id: playlist.id || Domain.createId("playlist"),
      name: String(playlist.name || "Playlist").slice(0, 32),
      description: playlist.description || "",
      cover_image_path: playlist.cover_image_path || "",
      createdAt: playlist.createdAt || playlist.created_at || now,
      updatedAt: playlist.updatedAt || playlist.updated_at || playlist.createdAt || playlist.created_at || now
    };
  }

  function ensureAudioDefaults(audio) {
    const now = new Date().toISOString();
    const durationSec = Number.isFinite(Number(audio.durationSec))
      ? Number(audio.durationSec)
      : Number(audio.duration_ms || audio.durationMs || audio.loopEndSec * 1000 || 0) / 1000;
    const originalDurationSec = Number.isFinite(Number(audio.originalDurationSec))
      ? Number(audio.originalDurationSec)
      : Number(audio.original_duration_ms || audio.duration_ms || durationSec * 1000) / 1000;
    const loopStartSec = Number.isFinite(Number(audio.loopStartSec)) ? Number(audio.loopStartSec) : 0;
    const loopEndSec = Number.isFinite(Number(audio.loopEndSec))
      ? Number(audio.loopEndSec)
      : Number.isFinite(Number(audio.trimmed_end_ms)) && Number.isFinite(Number(audio.trimmed_start_ms))
        ? Math.max(0.1, (Number(audio.trimmed_end_ms) - Number(audio.trimmed_start_ms)) / 1000)
        : durationSec || 30;
    const sourceTrimStartMs = Number.isFinite(Number(audio.trimmed_start_ms))
      ? Number(audio.trimmed_start_ms)
      : Math.round(loopStartSec * 1000);
    const sourceTrimEndMs = Number.isFinite(Number(audio.trimmed_end_ms))
      ? Number(audio.trimmed_end_ms)
      : Math.round((sourceTrimStartMs / 1000 + Math.max(0.1, durationSec || loopEndSec)) * 1000);

    audio.title = audio.title || "Untitled loop";
    audio.artist = audio.artist || audio.creator_name || audio.accountName || "Device import";
    audio.thumbnail = audio.thumbnail || audio.thumbnail_file_path || DEFAULT_THUMBNAIL;
    audio.thumbnail_file_path = audio.thumbnail_file_path || audio.thumbnail;
    audio.source_video_thumbnail = audio.source_video_thumbnail || audio.thumbnail;
    audio.audio_file_path = audio.audio_file_path || `indexeddb://${STORE_NAME}/${audio.id || "pending"}`;
    audio.loopStartSec = Math.max(0, loopStartSec);
    audio.durationSec = Math.max(0, durationSec);
    audio.originalDurationSec = Math.max(audio.durationSec, originalDurationSec);
    audio.loopEndSec = Math.max(audio.loopStartSec + 0.1, loopEndSec || audio.durationSec || 30);
    audio.duration_ms = Math.round(audio.durationSec * 1000);
    audio.original_duration_ms = Math.round(audio.originalDurationSec * 1000);
    audio.trimmed_start_ms = Math.round(sourceTrimStartMs);
    audio.trimmed_end_ms = Math.round(Math.max(sourceTrimStartMs + 100, sourceTrimEndMs));
    audio.trimmedDurationMs = Math.max(0, audio.trimmed_end_ms - audio.trimmed_start_ms);
    audio.loopLimitMode = audio.loopLimitMode || "forever";
    audio.loopStopAfterMinutes = Number.isFinite(Number(audio.loopStopAfterMinutes)) ? Number(audio.loopStopAfterMinutes) : 0;
    audio.loop_count = audio.loop_count || "infinite";
    audio.loopPreset = audio.loopPreset || {
      audio_item_id: audio.id || "",
      loop_start_ms: Math.round(audio.loopStartSec * 1000),
      loop_end_ms: Math.round(audio.loopEndSec * 1000),
      loop_count: audio.loop_count,
      sleep_timer_minutes: audio.loopStopAfterMinutes
    };
    audio.liked = Boolean(audio.liked);
    audio.playCount = Number.isFinite(Number(audio.playCount)) ? Number(audio.playCount) : 0;
    audio.shareCount = Number.isFinite(Number(audio.shareCount)) ? Number(audio.shareCount) : 0;
    audio.playlistIds = Array.isArray(audio.playlistIds) ? audio.playlistIds : [];
    audio.tags = Array.isArray(audio.tags) ? audio.tags : parseTags(audio.tagsText || audio.tags || "");
    audio.notes = audio.notes || "";
    audio.source_type = audio.source_type || audio.originalType || "device_import";
    audio.source_url = audio.source_url || audio.sourceUrl || "";
    audio.creator_name = audio.creator_name || audio.creatorName || "";
    audio.creator_profile_url = audio.creator_profile_url || audio.creatorProfileUrl || "";
    audio.rights_status = audio.rights_status || "user_provided";
    audio.original_video_file_name = audio.original_video_file_name || audio.fileName || audio.imported_file_name || "";
    audio.date_imported = audio.date_imported || audio.createdAt || audio.created_at || now;
    audio.createdAt = audio.createdAt || audio.created_at || audio.date_imported;
    audio.updatedAt = audio.updatedAt || audio.updated_at || audio.createdAt;
    audio.created_at = audio.createdAt;
    audio.updated_at = audio.updatedAt;
    audio.sourceVideo = audio.sourceVideo || {
      id: audio.sourceVideoId || Domain.createId("source"),
      original_file_path: audio.original_file_path || `local://${audio.original_video_file_name || "device-file"}`,
      imported_file_name: audio.original_video_file_name || "",
      video_duration_ms: audio.original_duration_ms,
      thumbnail_file_path: audio.thumbnail_file_path,
      source_url: audio.source_url
    };
    audio.sourceVideoId = audio.sourceVideo.id;
    return audio;
  }

  async function handleImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.audioFile.files[0];
    const requestedTrimEndSec = Math.max(0, Number(form.elements.trimEndSec.value) || 0);

    if (!file) {
      setStatus("Choose audio, video, or a Looper share.");
      return;
    }

    try {
      if (isShareFile(file)) {
        setStatus("Opening shared loop...");
        sharePreview = await readSharedPack(file);
        form.reset();
        form.elements.trimEndSec.value = String(AUTO_VIDEO_TRIM_SEC);
        setStatus("Shared loop ready");
        render();
        return;
      }

      const enforcedTrimSec = file.type.startsWith("video/")
        ? Math.max(AUTO_VIDEO_TRIM_SEC, requestedTrimEndSec)
        : requestedTrimEndSec;
      setStatus(file.type.startsWith("video/") ? "Extracting and trimming 4 sec..." : "Extracting preview...");
      importPreview = await createImportPreview(file, enforcedTrimSec);
      form.reset();
      form.elements.trimEndSec.value = String(AUTO_VIDEO_TRIM_SEC);
      setStatus("Preview ready");
      render();
    } catch (error) {
      setStatus(error.message || "Import failed");
    }
  }

  function isShareFile(file) {
    return /\.talshare$/i.test(file.name) || /\.loopshare$/i.test(file.name) || (file.type === "application/json" && /\.json$/i.test(file.name));
  }

  async function createImportPreview(file, trimEndSec) {
    const thumbnail = file.type.startsWith("video/") ? await makeVideoThumbnail(file) : DEFAULT_THUMBNAIL;
    const sourceType = file.type.startsWith("video/") ? "device_video" : "device_audio";
    const title = cleanTitle(file.name);
    const base = {
      id: Domain.createId("preview"),
      title,
      artist: "Device import",
      file,
      fileName: file.name,
      originalType: file.type,
      source_type: sourceType,
      source_url: "",
      creator_name: "",
      creator_profile_url: "",
      rights_status: "user_provided",
      thumbnail,
      autoTrimSec: trimEndSec,
      trimStartSec: 0,
      sourceVideo: {
        id: Domain.createId("source"),
        original_file_path: `local://${file.name}`,
        imported_file_name: file.name,
        video_duration_ms: 0,
        thumbnail_file_path: thumbnail,
        source_url: ""
      }
    };

    try {
      const audioBuffer = await decodeMediaToAudioBuffer(file);
      const originalDurationSec = audioBuffer.duration;
      const trimEndAtSec = Math.max(0.1, originalDurationSec - trimEndSec);
      const trimmedBuffer = sliceAudioBuffer(audioBuffer, 0, trimEndAtSec);
      return {
        ...base,
        audioBuffer,
        originalBlob: encodeWav(audioBuffer),
        trimmedBlob: encodeWav(trimmedBuffer),
        originalDurationSec,
        trimEndSec: trimEndAtSec,
        waveformPeaks: getWaveformPeaks(audioBuffer),
        sourceVideo: {
          ...base.sourceVideo,
          video_duration_ms: Math.round(originalDurationSec * 1000)
        }
      };
    } catch (_error) {
      const originalDurationSec = await readMediaDuration(file);
      const trimEndAtSec = Math.max(0.1, originalDurationSec - trimEndSec);
      const trimmedBlob = trimEndSec > 0 ? await trimWithMediaRecorder(file, trimEndSec, originalDurationSec) : file;
      return {
        ...base,
        audioBuffer: null,
        originalBlob: file,
        trimmedBlob,
        originalDurationSec,
        trimEndSec: trimEndAtSec || originalDurationSec || 0,
        waveformPeaks: makePlaceholderPeaks(72),
        sourceVideo: {
          ...base.sourceVideo,
          video_duration_ms: Math.round(originalDurationSec * 1000)
        }
      };
    }
  }

  async function readSharedPack(file) {
    const data = JSON.parse(await file.text());
    if (!data || ![SHARE_KIND, LEGACY_SHARE_KIND].includes(data.kind) || !data.audio || !data.audio.dataUrl) {
      throw new Error("This shared loop file is not supported.");
    }

    const blob = dataUrlToBlob(data.audio.dataUrl, data.audio.type || "audio/wav");
    const sound = data.sound || {};
    return {
      artist: sound.creator_name || sound.artist || "Shared loop",
      blob,
      creator_name: sound.creator_name || "",
      durationSec: Number(sound.durationSec || sound.duration_ms / 1000) || 0,
      fileName: data.audio.name || "shared-loop.wav",
      notes: sound.notes || "",
      source_url: sound.source_url || "",
      storedType: blob.type,
      tags: Array.isArray(sound.tags) ? sound.tags : [],
      thumbnail: sound.thumbnail || DEFAULT_THUMBNAIL,
      title: sound.title || "Shared loop"
    };
  }

  async function decodeMediaToAudioBuffer(file) {
    const context = new AudioContext();
    try {
      const arrayBuffer = await file.arrayBuffer();
      return await context.decodeAudioData(arrayBuffer);
    } finally {
      await context.close();
    }
  }

  function sliceAudioBuffer(audioBuffer, startSec, endSec) {
    const sampleRate = audioBuffer.sampleRate;
    const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
    const endFrame = Math.min(audioBuffer.length, Math.max(startFrame + 1, Math.ceil(endSec * sampleRate)));
    const frameCount = Math.max(1, endFrame - startFrame);
    const offline = new OfflineAudioContext(audioBuffer.numberOfChannels, frameCount, sampleRate);
    const sliced = offline.createBuffer(audioBuffer.numberOfChannels, frameCount, sampleRate);

    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const source = audioBuffer.getChannelData(channel).slice(startFrame, endFrame);
      sliced.copyToChannel(source, channel);
    }

    return sliced;
  }

  function encodeWav(audioBuffer) {
    const channelCount = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = channelCount * bytesPerSample;
    const dataSize = audioBuffer.length * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    let offset = 0;

    writeString(view, offset, "RIFF");
    offset += 4;
    view.setUint32(offset, 36 + dataSize, true);
    offset += 4;
    writeString(view, offset, "WAVE");
    offset += 4;
    writeString(view, offset, "fmt ");
    offset += 4;
    view.setUint32(offset, 16, true);
    offset += 4;
    view.setUint16(offset, 1, true);
    offset += 2;
    view.setUint16(offset, channelCount, true);
    offset += 2;
    view.setUint32(offset, sampleRate, true);
    offset += 4;
    view.setUint32(offset, sampleRate * blockAlign, true);
    offset += 4;
    view.setUint16(offset, blockAlign, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
    writeString(view, offset, "data");
    offset += 4;
    view.setUint32(offset, dataSize, true);
    offset += 4;

    const channelData = Array.from({ length: channelCount }, (_value, index) => audioBuffer.getChannelData(index));
    for (let frame = 0; frame < audioBuffer.length; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelData[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }

    return new Blob([buffer], { type: "audio/wav" });
  }

  function writeString(view, offset, value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  function getWaveformPeaks(audioBuffer, bucketCount = 96) {
    const data = audioBuffer.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bucketCount));
    return Array.from({ length: bucketCount }, (_value, bucket) => {
      let peak = 0;
      const start = bucket * block;
      const end = Math.min(data.length, start + block);
      for (let index = start; index < end; index += 1) {
        peak = Math.max(peak, Math.abs(data[index]));
      }
      return peak;
    });
  }

  function makePlaceholderPeaks(count) {
    return Array.from({ length: count }, (_value, index) => 0.18 + Math.abs(Math.sin(index * 0.61)) * 0.72);
  }

  async function readMediaDuration(file) {
    return new Promise((resolve) => {
      const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
      const url = URL.createObjectURL(file);
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        const duration = Number.isFinite(media.duration) ? media.duration : 0;
        URL.revokeObjectURL(url);
        resolve(duration);
      };
      media.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(0);
      };
      media.src = url;
    });
  }

  async function trimWithMediaRecorder(file, trimEndSec, durationSec) {
    if (!file.type.startsWith("video/") || !HTMLMediaElement.prototype.captureStream || !window.MediaRecorder) {
      return file;
    }

    const recordUntil = Math.max(0, durationSec - trimEndSec);
    if (!recordUntil) {
      return file;
    }

    return new Promise((resolve) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      const chunks = [];
      let recorder;

      video.muted = true;
      video.playsInline = true;
      video.src = url;
      video.onloadedmetadata = () => {
        const stream = video.captureStream();
        const audioTracks = stream.getAudioTracks();
        if (!audioTracks.length) {
          URL.revokeObjectURL(url);
          resolve(file);
          return;
        }
        recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: "audio/webm" });
        recorder.ondataavailable = (event) => {
          if (event.data.size) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = () => {
          URL.revokeObjectURL(url);
          resolve(new Blob(chunks, { type: "audio/webm" }));
        };
        recorder.start();
        video.play().catch(() => {
          URL.revokeObjectURL(url);
          resolve(file);
        });
        window.setTimeout(() => {
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          video.pause();
        }, recordUntil * 1000);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
    });
  }

  async function makeVideoThumbnail(file) {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = url;
      video.onloadedmetadata = () => {
        video.currentTime = Math.min(0.25, Math.max(0, video.duration / 4 || 0));
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 240;
        canvas.height = 240;
        const ctx = canvas.getContext("2d");
        const side = Math.min(video.videoWidth || 240, video.videoHeight || 240);
        const sx = ((video.videoWidth || side) - side) / 2;
        const sy = ((video.videoHeight || side) - side) / 2;
        ctx.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(DEFAULT_THUMBNAIL);
      };
    });
  }

  function formatDuration(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return "Saved today";
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function getVisibleAudios() {
    const query = state.searchQuery.trim().toLowerCase();
    let audios = state.audios.map(ensureAudioDefaults);

    if (query) {
      audios = audios.filter((audio) => {
        return [audio.title, audio.artist, audio.creator_name, audio.fileName, audio.notes, audio.tags.join(" ")]
          .some((value) => String(value || "").toLowerCase().includes(query));
      });
    }

    if (state.selectedView === "liked") {
      audios = audios.filter((audio) => audio.liked);
    } else if (state.selectedView === "playlists") {
      audios = state.selectedPlaylistId
        ? audios.filter((audio) => audio.playlistIds.includes(state.selectedPlaylistId))
        : audios.filter((audio) => audio.playlistIds.length > 0);
    }

    if (state.selectedView === "trending") {
      audios = audios.slice().sort((a, b) => trendScore(b) - trendScore(a));
    } else if (state.selectedView === "top") {
      audios = audios.slice().sort((a, b) => {
        return b.playCount - a.playCount || Number(b.liked) - Number(a.liked) || dateValue(b.createdAt) - dateValue(a.createdAt);
      });
    } else {
      audios = audios.slice().sort((a, b) => dateValue(b.createdAt) - dateValue(a.createdAt));
    }

    return audios;
  }

  function trendScore(audio) {
    const ageHours = Math.max(1, (Date.now() - dateValue(audio.createdAt)) / 36e5);
    const recentPlayBoost = audio.lastPlayedAt ? Math.max(0, 24 - (Date.now() - dateValue(audio.lastPlayedAt)) / 36e5) : 0;
    return audio.playCount * 6 + audio.shareCount * 3 + (audio.liked ? 5 : 0) + recentPlayBoost + 12 / ageHours;
  }

  function dateValue(value) {
    const time = new Date(value || 0).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  function render() {
    state = normalizeState(state);
    els.soundCount.textContent = String(state.audios.length);
    els.likedCount.textContent = String(state.audios.filter((audio) => audio.liked).length);
    els.playlistCount.textContent = String(state.playlists.length);
    els.searchInput.value = state.searchQuery;
    renderViewButtons();
    renderPlaylistControls();
    renderQueueControls();
    renderSharePreview();
    renderImportPreview();

    const audios = getVisibleAudios();
    if (!audios.length) {
      els.audioList.innerHTML = `<div class="empty-state">${emptyStateText()}</div>`;
      renderNowPlaying();
      return;
    }

    const template = document.querySelector("#audioRowTemplate");
    const rows = audios.map((audio) => {
      const row = template.content.firstElementChild.cloneNode(true);
      const playlistId = actionPlaylistId();
      const isInPlaylist = playlistId && audio.playlistIds.includes(playlistId);
      const isPlaying = audio.id === state.playingId && !els.mainAudio.paused;
      row.dataset.audioId = audio.id;
      row.classList.toggle("is-active", audio.id === state.editingId || audio.id === state.playingId);
      row.classList.toggle("is-playing", isPlaying);
      row.querySelector(".thumb-button").setAttribute("aria-label", `${isPlaying ? "Pause" : "Play"} ${audio.title}`);
      const image = row.querySelector(".thumb-image");
      image.src = audio.thumbnail;
      image.alt = `${audio.title} thumbnail`;
      row.querySelector(".sound-title-button").textContent = audio.title;
      row.querySelector(".sound-artist").textContent = audio.creator_name || audio.artist;
      row.querySelector(".sound-duration").textContent = `${formatDuration(audio.durationSec)} loop | ${formatDuration(audio.originalDurationSec)} source`;
      row.querySelector(".sound-meta").textContent = `${audio.playCount} plays | ${audio.shareCount} shares | ${formatDate(audio.createdAt)}`;
      row.querySelector(".sound-context").textContent = audio.notes || audio.original_video_file_name || audio.source_url || "Personal loop";
      renderPlaylistBadges(row.querySelector(".playlist-badges"), audio);

      const likeButtons = row.querySelectorAll('[data-action="toggle-like"]');
      likeButtons.forEach((button) => {
        button.textContent = audio.liked ? "Liked" : "Like";
        button.classList.toggle("is-on", audio.liked);
        button.setAttribute("aria-label", `${audio.liked ? "Unlike" : "Like"} ${audio.title}`);
      });

      const playlistButtons = row.querySelectorAll('[data-action="toggle-playlist"]');
      playlistButtons.forEach((button) => {
        button.textContent = isInPlaylist ? "In list" : "Add";
        button.disabled = !playlistId;
        button.classList.toggle("is-on", Boolean(isInPlaylist));
        button.setAttribute("aria-label", playlistId ? `${isInPlaylist ? "Remove from" : "Add to"} playlist` : "Create a playlist first");
      });

      const controls = row.querySelector(".inline-controls");
      controls.hidden = audio.id !== state.editingId;
      controls.querySelector('[data-field="title"]').value = audio.title;
      controls.querySelector('[data-field="artist"]').value = audio.artist;
      controls.querySelector('[data-field="creator_name"]').value = audio.creator_name;
      controls.querySelector('[data-field="source_url"]').value = audio.source_url;
      controls.querySelector('[data-field="tagsText"]').value = audio.tags.join(", ");
      controls.querySelector('[data-field="notes"]').value = audio.notes;
      controls.querySelector('[data-field="loopStartSec"]').value = audio.loopStartSec;
      controls.querySelector('[data-field="loopEndSec"]').value = audio.loopEndSec;
      controls.querySelector('[data-field="loopLimitMode"]').value = audio.loopLimitMode;
      controls.querySelector('[data-field="loopStopAfterMinutes"]').value = audio.loopStopAfterMinutes;
      return row;
    });

    els.audioList.replaceChildren(...rows);
    renderNowPlaying();
  }

  function renderViewButtons() {
    els.viewButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.selectedView);
    });
  }

  function renderQueueControls() {
    els.queueCount.textContent = `Queue ${state.queueIds.length}`;
    els.queuePanel.querySelector('[data-action="toggle-repeat-sound"]').classList.toggle("is-active", state.repeatMode === "sound");
    els.queuePanel.querySelector('[data-action="toggle-repeat-playlist"]').classList.toggle("is-active", state.repeatMode === "playlist");
    els.queuePanel.querySelector('[data-action="toggle-shuffle"]').classList.toggle("is-active", state.shuffleEnabled);
  }

  function renderPlaylistControls() {
    const selected = state.selectedPlaylistId;
    const options = [new Option("All playlists", "")].concat(state.playlists.map((playlist) => new Option(playlist.name, playlist.id)));
    els.playlistFilter.replaceChildren(...options);
    els.playlistFilter.value = selected;

    const shareOptions = [new Option("No playlist", "")].concat(state.playlists.map((playlist) => new Option(playlist.name, playlist.id)));
    els.sharePlaylistSelect.replaceChildren(...shareOptions);
    els.sharePlaylistSelect.value = selected;
  }

  function renderSharePreview() {
    els.sharePreview.hidden = !sharePreview;
    if (!sharePreview) {
      return;
    }
    els.sharePreviewThumb.src = sharePreview.thumbnail || DEFAULT_THUMBNAIL;
    els.sharePreviewThumb.alt = `${sharePreview.title} thumbnail`;
    els.sharePreviewTitle.textContent = sharePreview.title;
    els.sharePreviewMeta.textContent = `${sharePreview.artist} | ${formatDuration(sharePreview.durationSec)}`;
  }

  function renderImportPreview() {
    els.importPreview.hidden = !importPreview;
    if (!importPreview) {
      return;
    }

    const duration = Math.max(0.1, importPreview.originalDurationSec || 0.1);
    els.importPreviewThumb.src = importPreview.thumbnail || DEFAULT_THUMBNAIL;
    els.importPreviewThumb.alt = `${importPreview.title} thumbnail`;
    els.importPreviewTitle.textContent = importPreview.title;
    els.originalDuration.textContent = formatDuration(importPreview.originalDurationSec);
    els.trimmedDuration.textContent = formatDuration(getPreviewTrimmedDuration());
    [els.trimStartRange, els.trimEndRange].forEach((range) => {
      range.max = String(duration);
    });
    els.trimStartRange.value = String(importPreview.trimStartSec);
    els.trimEndRange.value = String(importPreview.trimEndSec);
    drawWaveform();
  }

  function drawWaveform() {
    const canvas = els.waveformCanvas;
    const ctx = canvas.getContext("2d");
    const peaks = importPreview?.waveformPeaks || makePlaceholderPeaks(96);
    const width = canvas.width;
    const height = canvas.height;
    const trimStartRatio = (importPreview.trimStartSec || 0) / Math.max(0.1, importPreview.originalDurationSec || 0.1);
    const trimEndRatio = (importPreview.trimEndSec || 0) / Math.max(0.1, importPreview.originalDurationSec || 0.1);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#101827";
    ctx.fillRect(0, 0, width, height);
    peaks.forEach((peak, index) => {
      const x = (index / peaks.length) * width;
      const barWidth = Math.max(3, width / peaks.length - 3);
      const barHeight = Math.max(8, peak * height * 0.78);
      const inTrim = index / peaks.length >= trimStartRatio && index / peaks.length <= trimEndRatio;
      ctx.fillStyle = inTrim ? "#37e7c4" : "rgba(255,255,255,0.18)";
      ctx.fillRect(x, (height - barHeight) / 2, barWidth, barHeight);
    });
  }

  function renderPlaylistBadges(container, audio) {
    const tagNames = audio.tags.slice(0, 3);
    const playlistNames = audio.playlistIds
      .map((id) => state.playlists.find((playlist) => playlist.id === id)?.name)
      .filter(Boolean)
      .slice(0, 2);
    container.replaceChildren(...playlistNames.concat(tagNames).map((name) => {
      const badge = document.createElement("span");
      badge.textContent = name;
      return badge;
    }));
  }

  function emptyStateText() {
    if (state.searchQuery.trim()) {
      return "No matching loops.";
    }
    if (state.selectedView === "liked") {
      return "Liked loops will appear here.";
    }
    if (state.selectedView === "playlists") {
      return state.playlists.length ? "Add loops to this playlist." : "Create a playlist to start sorting loops.";
    }
    if (state.selectedView === "trending") {
      return "Play, like, or share loops to build local trends.";
    }
    if (state.selectedView === "top") {
      return "Your most-played loops will appear here.";
    }
    return "Import a video or audio file to create your first loop.";
  }

  function renderNowPlaying() {
    const audio = state.audios.find((item) => item.id === state.playingId);
    els.nowPlayingBar.hidden = !audio;
    if (!audio) {
      return;
    }

    const toggleButton = els.nowPlayingBar.querySelector('[data-action="toggle-current"]');
    toggleButton.textContent = els.mainAudio.paused ? "Play" : "Pause";
    els.nowTitle.textContent = audio.title;
    els.nowSubtitle.textContent =
      audio.loopLimitMode === "timed" && audio.loopStopAfterMinutes > 0
        ? `Loops for ${audio.loopStopAfterMinutes} min`
        : queueSubtitle();
  }

  function queueSubtitle() {
    if (state.repeatMode === "sound") {
      return "Repeating this sound";
    }
    if (state.shuffleEnabled) {
      return "Shuffle playlist";
    }
    if (state.repeatMode === "playlist") {
      return "Repeating playlist";
    }
    return state.queueIds.length ? `${state.queueIds.length} queued` : "Looping forever";
  }

  async function toggleRowPlayback(id) {
    if (state.playingId === id && !els.mainAudio.paused) {
      els.mainAudio.pause();
      render();
      return;
    }
    await playAudio(id);
  }

  async function playAudio(id, options = {}) {
    const audio = state.audios.find((item) => item.id === id);
    if (!audio) {
      return;
    }
    const blob = await getAudioBlob(id);
    if (!blob) {
      setStatus("Stored audio is missing.");
      return;
    }

    pausePreview();
    revokeActiveAudioUrl();
    activeAudioUrl = URL.createObjectURL(blob);
    state.playingId = id;
    if (!options.silentCount) {
      audio.playCount += 1;
    }
    audio.lastPlayedAt = new Date().toISOString();
    audio.updatedAt = audio.lastPlayedAt;
    loopStartedAt = performance.now();
    els.mainAudio.src = activeAudioUrl;
    els.mainAudio.currentTime = Math.max(0, Number(audio.loopStartSec) || 0);
    await els.mainAudio.play();
    saveState();
    render();
  }

  async function selectRelativeTrack(direction) {
    const nextId = pickTrack(direction);
    if (nextId) {
      await playAudio(nextId);
    }
  }

  function pickTrack(direction) {
    if (direction > 0 && state.queueIds.length) {
      const nextId = state.queueIds.shift();
      saveState();
      return nextId;
    }

    const queue = getVisibleAudios();
    if (!queue.length) {
      return null;
    }
    if (state.shuffleEnabled && direction > 0) {
      return queue[Math.floor(Math.random() * queue.length)].id;
    }
    const currentId = state.playingId || state.editingId || queue[0].id;
    const currentIndex = Math.max(0, queue.findIndex((audio) => audio.id === currentId));
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= queue.length) {
      return state.repeatMode === "playlist" ? queue[(nextIndex + queue.length) % queue.length].id : null;
    }
    return queue[nextIndex].id;
  }

  async function playNextAfterEnd() {
    if (state.repeatMode === "sound" && state.playingId) {
      await playAudio(state.playingId, { silentCount: true });
      return;
    }
    const nextId = pickTrack(1);
    if (nextId) {
      await playAudio(nextId);
    }
  }

  function revokeActiveAudioUrl() {
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = null;
    }
  }

  function revokePreviewUrl() {
    if (activePreviewUrl) {
      URL.revokeObjectURL(activePreviewUrl);
      activePreviewUrl = null;
    }
  }

  function updateSelectedField(field, value, inputType) {
    const audio = state.audios.find((item) => item.id === state.editingId);
    if (!audio) {
      return;
    }
    if (field === "tagsText") {
      audio.tags = parseTags(value);
    } else if (
      ["title", "artist", "creator_name", "creator_profile_url", "source_url", "notes", "loopLimitMode"].includes(field)
    ) {
      audio[field] = value;
    } else {
      audio[field] = Number(value);
    }
    if (field === "loopEndSec") {
      audio.loopEndSec = Math.max(audio.loopStartSec + 0.1, audio.loopEndSec);
    }
    if (field === "loopStartSec") {
      audio.loopStartSec = Math.max(0, audio.loopStartSec);
      audio.loopEndSec = Math.max(audio.loopStartSec + 0.1, audio.loopEndSec);
    }
    audio.loopPreset = {
      audio_item_id: audio.id,
      loop_start_ms: Math.round(audio.loopStartSec * 1000),
      loop_end_ms: Math.round(audio.loopEndSec * 1000),
      loop_count: audio.loopLimitMode === "timed" ? "timed" : "infinite",
      sleep_timer_minutes: audio.loopStopAfterMinutes
    };
    audio.updatedAt = new Date().toISOString();
    audio.updated_at = audio.updatedAt;
    if (audio.sourceVideo) {
      audio.sourceVideo.source_url = audio.source_url;
    }
    saveState();
    renderNowPlaying();
    if (inputType !== "text" && inputType !== "url") {
      render();
    }
  }

  function parseTags(value) {
    if (Array.isArray(value)) {
      return value;
    }
    return String(value || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function toggleLike(id) {
    const audio = state.audios.find((item) => item.id === id);
    if (!audio) {
      return;
    }
    audio.liked = !audio.liked;
    audio.updatedAt = new Date().toISOString();
    saveState();
    render();
  }

  function actionPlaylistId() {
    if (state.selectedPlaylistId) {
      return state.selectedPlaylistId;
    }
    return state.playlists[0]?.id || "";
  }

  function togglePlaylistMembership(id) {
    const playlistId = actionPlaylistId();
    const audio = state.audios.find((item) => item.id === id);
    if (!audio) {
      return;
    }
    if (!playlistId) {
      setStatus("Create a playlist first.");
      return;
    }
    if (audio.playlistIds.includes(playlistId)) {
      audio.playlistIds = audio.playlistIds.filter((item) => item !== playlistId);
      setStatus("Removed from playlist");
    } else {
      audio.playlistIds.push(playlistId);
      setStatus("Added to playlist");
    }
    audio.updatedAt = new Date().toISOString();
    saveState();
    render();
  }

  function enqueueAudio(id, next) {
    state.queueIds = state.queueIds.filter((queuedId) => queuedId !== id);
    if (next) {
      state.queueIds.unshift(id);
      setStatus("Will play next");
    } else {
      state.queueIds.push(id);
      setStatus("Added to queue");
    }
    saveState();
    render();
  }

  async function deleteAudio(id) {
    const audio = state.audios.find((item) => item.id === id);
    if (!audio || !window.confirm(`Delete "${audio.title}"?`)) {
      return;
    }

    if (state.playingId === id) {
      els.mainAudio.pause();
      els.mainAudio.removeAttribute("src");
      state.playingId = null;
      revokeActiveAudioUrl();
    }

    state.audios = state.audios.filter((item) => item.id !== id);
    state.queueIds = state.queueIds.filter((item) => item !== id);
    if (state.editingId === id) {
      state.editingId = null;
    }
    await deleteAudioBlob(id);
    saveState();
    setStatus("Deleted");
    render();
  }

  function createPlaylist(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
      setStatus("Name the playlist first.");
      return;
    }
    const playlist = ensurePlaylistDefaults({
      id: Domain.createId("playlist"),
      name: trimmed,
      createdAt: new Date().toISOString()
    });
    state.playlists.unshift(playlist);
    state.selectedPlaylistId = playlist.id;
    state.selectedView = "playlists";
    saveState();
    setStatus("Playlist created");
    render();
  }

  async function shareAudio(id) {
    const audio = state.audios.find((item) => item.id === id);
    if (!audio) {
      return;
    }
    const blob = await getAudioBlob(id);
    if (!blob) {
      setStatus("Stored audio is missing.");
      return;
    }

    setStatus("Preparing share...");
    const pack = {
      kind: SHARE_KIND,
      version: 1,
      sharedAt: new Date().toISOString(),
      sound: {
        creator_name: audio.creator_name,
        duration_ms: audio.duration_ms,
        notes: audio.notes,
        source_url: audio.source_url,
        tags: audio.tags,
        thumbnail: audio.thumbnail,
        title: audio.title
      },
      audio: {
        dataUrl: await blobToDataUrl(blob),
        name: `${slugify(audio.title)}.wav`,
        type: blob.type || audio.storedType || "audio/wav"
      }
    };
    const shareFile = new File([JSON.stringify(pack)], `${slugify(audio.title)}.loopshare`, { type: "application/json" });

    try {
      if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          text: "Listen first, then save it to Looper.",
          title: audio.title
        });
        setStatus("Share sent");
      } else {
        downloadBlob(shareFile, shareFile.name);
        setStatus("Share pack downloaded");
      }
      audio.shareCount += 1;
      audio.updatedAt = new Date().toISOString();
      saveState();
      render();
    } catch (error) {
      setStatus(error && error.name !== "AbortError" ? "Share failed" : "Share canceled");
    }
  }

  async function playPendingPreview(kind, shouldLoop) {
    if (!importPreview) {
      return;
    }
    els.mainAudio.pause();
    revokePreviewUrl();
    activePreviewUrl = URL.createObjectURL(kind === "original" ? importPreview.originalBlob : importPreview.trimmedBlob);
    els.previewAudio.loop = Boolean(shouldLoop);
    els.previewAudio.src = activePreviewUrl;
    els.previewAudio.currentTime = 0;
    await els.previewAudio.play();
    setStatus(kind === "original" ? "Playing original" : shouldLoop ? "Looping preview" : "Playing trimmed");
  }

  async function updatePendingTrim() {
    if (!importPreview) {
      return;
    }
    const duration = Math.max(0.1, importPreview.originalDurationSec);
    let start = Math.max(0, Number(els.trimStartRange.value) || 0);
    let end = Math.min(duration, Number(els.trimEndRange.value) || duration);
    if (end <= start + 0.1) {
      end = Math.min(duration, start + 0.1);
      start = Math.max(0, end - 0.1);
    }
    importPreview.trimStartSec = start;
    importPreview.trimEndSec = end;
    if (importPreview.audioBuffer) {
      importPreview.trimmedBlob = encodeWav(sliceAudioBuffer(importPreview.audioBuffer, start, end));
    }
    renderImportPreview();
  }

  function getPreviewTrimmedDuration() {
    if (!importPreview) {
      return 0;
    }
    return Math.max(0, importPreview.trimEndSec - importPreview.trimStartSec);
  }

  async function saveImportPreview() {
    if (!importPreview) {
      return;
    }
    const id = Domain.createId("audio");
    const trimmedDurationSec = getPreviewTrimmedDuration();
    await putAudioBlob(id, importPreview.trimmedBlob);

    const now = new Date().toISOString();
    const audio = ensureAudioDefaults({
      id,
      title: importPreview.title,
      artist: importPreview.artist,
      fileName: importPreview.fileName,
      original_video_file_name: importPreview.fileName,
      originalType: importPreview.originalType,
      storedType: importPreview.trimmedBlob.type,
      fileSize: importPreview.trimmedBlob.size,
      audio_file_path: `indexeddb://${STORE_NAME}/${id}`,
      thumbnail: importPreview.thumbnail,
      thumbnail_file_path: importPreview.thumbnail,
      source_video_thumbnail: importPreview.thumbnail,
      source_type: importPreview.source_type,
      source_url: importPreview.source_url,
      creator_name: importPreview.creator_name,
      creator_profile_url: importPreview.creator_profile_url,
      rights_status: importPreview.rights_status,
      originalDurationSec: importPreview.originalDurationSec,
      durationSec: trimmedDurationSec,
      duration_ms: Math.round(trimmedDurationSec * 1000),
      original_duration_ms: Math.round(importPreview.originalDurationSec * 1000),
      trimmed_start_ms: Math.round(importPreview.trimStartSec * 1000),
      trimmed_end_ms: Math.round(importPreview.trimEndSec * 1000),
      loopStartSec: 0,
      loopEndSec: trimmedDurationSec,
      loopLimitMode: "forever",
      loopStopAfterMinutes: 0,
      loop_count: "infinite",
      liked: false,
      playlistIds: state.selectedPlaylistId ? [state.selectedPlaylistId] : [],
      playCount: 0,
      shareCount: 0,
      tags: [],
      notes: "",
      sourceVideo: {
        ...importPreview.sourceVideo,
        source_url: importPreview.source_url,
        thumbnail_file_path: importPreview.thumbnail,
        video_duration_ms: Math.round(importPreview.originalDurationSec * 1000)
      },
      date_imported: now,
      createdAt: now,
      updatedAt: now
    });

    state.audios.unshift(audio);
    importPreview = null;
    pausePreview();
    revokePreviewUrl();
    saveState();
    setStatus("Saved to Looper");
    render();
  }

  function discardImportPreview() {
    importPreview = null;
    pausePreview();
    revokePreviewUrl();
    setStatus("Discarded");
    render();
  }

  async function playSharePreview() {
    if (!sharePreview) {
      return;
    }
    els.mainAudio.pause();
    revokePreviewUrl();
    activePreviewUrl = URL.createObjectURL(sharePreview.blob);
    els.previewAudio.loop = true;
    els.previewAudio.src = activePreviewUrl;
    els.previewAudio.currentTime = 0;
    await els.previewAudio.play();
    setStatus("Preview playing");
  }

  function pausePreview() {
    els.previewAudio.pause();
    els.previewAudio.loop = false;
  }

  async function saveSharePreview(liked) {
    if (!sharePreview) {
      return;
    }
    const id = Domain.createId("audio");
    await putAudioBlob(id, sharePreview.blob);
    const playlistId = els.sharePlaylistSelect.value || state.selectedPlaylistId || "";
    const now = new Date().toISOString();
    state.audios.unshift(ensureAudioDefaults({
      id,
      title: sharePreview.title,
      artist: sharePreview.artist,
      creator_name: sharePreview.creator_name,
      fileName: sharePreview.fileName,
      original_video_file_name: sharePreview.fileName,
      originalType: "shared",
      storedType: sharePreview.storedType,
      fileSize: sharePreview.blob.size,
      audio_file_path: `indexeddb://${STORE_NAME}/${id}`,
      durationSec: sharePreview.durationSec,
      thumbnail: sharePreview.thumbnail,
      loopStartSec: 0,
      loopEndSec: sharePreview.durationSec || 30,
      loopLimitMode: "forever",
      loopStopAfterMinutes: 0,
      liked,
      playlistIds: playlistId ? [playlistId] : [],
      importedFromShare: true,
      notes: sharePreview.notes,
      source_url: sharePreview.source_url,
      tags: sharePreview.tags,
      date_imported: now,
      createdAt: now,
      updatedAt: now
    }));
    sharePreview = null;
    pausePreview();
    revokePreviewUrl();
    saveState();
    setStatus(liked ? "Saved to liked" : "Saved");
    render();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl, fallbackType) {
    const parts = String(dataUrl).split(",");
    const meta = parts[0] || "";
    const data = parts[1] || "";
    const mime = (meta.match(/^data:([^;]+)/) || [])[1] || fallbackType;
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mime });
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function slugify(value) {
    return String(value || "shared-loop")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "shared-loop";
  }

  async function handleAudioTimeUpdate() {
    const audio = state.audios.find((item) => item.id === state.playingId);
    if (!audio || advancingTrack) {
      return;
    }

    const start = Math.max(0, Number(audio.loopStartSec) || 0);
    const end = Math.max(start + 0.1, Number(audio.loopEndSec) || els.mainAudio.duration || start + 0.1);
    const stopAfterMs = Math.max(0, Number(audio.loopStopAfterMinutes) || 0) * 60 * 1000;
    if (audio.loopLimitMode === "timed" && stopAfterMs > 0 && loopStartedAt && performance.now() - loopStartedAt >= stopAfterMs) {
      els.mainAudio.pause();
      els.mainAudio.currentTime = start;
      setStatus("Timed loop finished");
      render();
      return;
    }
    if (els.mainAudio.currentTime < start) {
      els.mainAudio.currentTime = start;
    }
    if (els.mainAudio.currentTime >= end) {
      if (shouldAdvanceAfterLoop()) {
        advancingTrack = true;
        try {
          await playNextAfterEnd();
        } finally {
          advancingTrack = false;
        }
        return;
      }
      els.mainAudio.currentTime = start;
      els.mainAudio.play().catch(() => {});
    }
  }

  async function handleNaturalEnd() {
    if (!state.playingId || advancingTrack) {
      return;
    }
    advancingTrack = true;
    try {
      if (shouldAdvanceAfterLoop()) {
        await playNextAfterEnd();
      } else {
        await playAudio(state.playingId, { silentCount: true });
      }
    } finally {
      advancingTrack = false;
    }
  }

  function shouldAdvanceAfterLoop() {
    return state.repeatMode !== "sound" && (state.queueIds.length > 0 || state.repeatMode === "playlist" || state.shuffleEnabled);
  }

  els.importForm.addEventListener("submit", handleImport);

  els.playlistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createPlaylist(event.currentTarget.elements.playlistName.value);
    event.currentTarget.reset();
  });

  els.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value;
    saveState();
    render();
  });

  els.playlistFilter.addEventListener("change", (event) => {
    state.selectedPlaylistId = event.target.value;
    state.selectedView = "playlists";
    saveState();
    render();
  });

  els.viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedView = button.dataset.view;
      saveState();
      render();
    });
  });

  els.queuePanel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "toggle-repeat-sound") {
      state.repeatMode = state.repeatMode === "sound" ? "none" : "sound";
    } else if (action === "toggle-repeat-playlist") {
      state.repeatMode = state.repeatMode === "playlist" ? "none" : "playlist";
    } else if (action === "toggle-shuffle") {
      state.shuffleEnabled = !state.shuffleEnabled;
    }
    saveState();
    render();
  });

  els.sharePreview.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "preview-play") {
      await playSharePreview();
    } else if (action === "save-share") {
      await saveSharePreview(false);
    } else if (action === "save-share-liked") {
      await saveSharePreview(true);
    }
  });

  els.importPreview.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "play-original") {
      await playPendingPreview("original", false);
    } else if (action === "play-trimmed") {
      await playPendingPreview("trimmed", false);
    } else if (action === "loop-preview") {
      await playPendingPreview("trimmed", true);
    } else if (action === "adjust-trim") {
      els.trimStartRange.focus();
      setStatus("Adjust handles");
    } else if (action === "save-preview") {
      await saveImportPreview();
    } else if (action === "discard-preview") {
      discardImportPreview();
    }
  });

  els.trimStartRange.addEventListener("input", updatePendingTrim);
  els.trimEndRange.addEventListener("input", updatePendingTrim);

  els.audioList.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-audio-id]");
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!row || !action) {
      return;
    }

    const id = row.dataset.audioId;
    if (action === "toggle-row") {
      await toggleRowPlayback(id);
    } else if (action === "select-row") {
      state.editingId = state.editingId === id ? null : id;
      saveState();
      render();
    } else if (action === "toggle-like") {
      toggleLike(id);
    } else if (action === "toggle-playlist") {
      togglePlaylistMembership(id);
    } else if (action === "delete-audio") {
      await deleteAudio(id);
    } else if (action === "share-audio") {
      await shareAudio(id);
    } else if (action === "queue-next") {
      enqueueAudio(id, true);
    } else if (action === "add-queue") {
      enqueueAudio(id, false);
    }
  });

  els.audioList.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    if (!field) {
      return;
    }
    updateSelectedField(field, event.target.value, event.target.type);
  });

  els.audioList.addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    if (!field) {
      return;
    }
    updateSelectedField(field, event.target.value, event.target.type);
    render();
  });

  els.nowPlayingBar.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }
    if (action === "previous-track") {
      await selectRelativeTrack(-1);
    } else if (action === "next-track") {
      await selectRelativeTrack(1);
    } else if (action === "toggle-current") {
      if (els.mainAudio.paused && state.playingId) {
        await els.mainAudio.play();
      } else {
        els.mainAudio.pause();
      }
      render();
    }
  });

  els.mainAudio.addEventListener("timeupdate", handleAudioTimeUpdate);
  els.mainAudio.addEventListener("play", () => {
    loopStartedAt = performance.now();
    renderNowPlaying();
    render();
  });
  els.mainAudio.addEventListener("pause", () => {
    renderNowPlaying();
    render();
  });
  els.mainAudio.addEventListener("ended", handleNaturalEnd);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  document.querySelector(".tab-bar .is-active")?.scrollIntoView({ inline: "center", block: "nearest" });
  saveState();
  render();
})();







