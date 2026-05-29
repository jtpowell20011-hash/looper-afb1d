"use strict";

(function attachDomain(globalScope) {
  const THUMBNAIL_TTL_HOURS = 6;
  const PLAYABLE_POLICIES = Object.freeze({
    APPLE_MUSIC: "apple_music",
    CREATOR_UPLOAD: "creator_upload",
    REFERENCE_ONLY: "reference_only",
    SOUNDCLOUD_STREAM: "soundcloud_stream",
    SPOTIFY_HANDOFF: "spotify_handoff",
    TIKTOK_EMBED: "tiktok_embed"
  });

  const RIGHTS_STATUS = Object.freeze({
    BLOCKED: "blocked",
    CLEARED: "cleared",
    NEEDS_REVIEW: "needs_review",
    REFERENCE_ONLY: "reference_only"
  });

  function createId(prefix) {
    const token = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${token}`;
  }

  function addHours(isoDate, hours) {
    const date = new Date(isoDate);
    date.setHours(date.getHours() + hours);
    return date.toISOString();
  }

  function normalizeTikTokUrl(rawUrl) {
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) {
      throw new Error("A TikTok URL is required.");
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isTikTokHost =
      hostname === "tiktok.com" ||
      hostname.endsWith(".tiktok.com") ||
      hostname === "vm.tiktok.com" ||
      hostname === "vt.tiktok.com";

    if (parsed.protocol !== "https:" || !isTikTokHost) {
      throw new Error("Use a public HTTPS TikTok link.");
    }

    parsed.hash = "";
    return parsed.toString();
  }

  function isTikTokSoundPageUrl(rawUrl) {
    try {
      const parsed = new URL(normalizeTikTokUrl(rawUrl));
      const pathname = parsed.pathname.toLowerCase();
      return pathname.startsWith("/music/") || pathname.startsWith("/sound/");
    } catch (_error) {
      return false;
    }
  }

  function extractTikTokPostId(rawUrl) {
    try {
      const parsed = new URL(normalizeTikTokUrl(rawUrl));
      const match = parsed.pathname.match(/\/(?:@[^/]+\/)?(?:video|photo)\/(\d+)/i);
      return match ? match[1] : null;
    } catch (_error) {
      return null;
    }
  }

  function buildTikTokPlayerUrl(rawUrl) {
    const postId = extractTikTokPostId(rawUrl);
    if (!postId) {
      return null;
    }

    const playerUrl = new URL(`https://www.tiktok.com/player/v1/${postId}`);
    playerUrl.searchParams.set("controls", "1");
    playerUrl.searchParams.set("music_info", "1");
    playerUrl.searchParams.set("description", "1");
    playerUrl.searchParams.set("loop", "1");
    playerUrl.searchParams.set("rel", "0");
    return playerUrl.toString();
  }

  function getTikTokReferenceKind(rawUrl) {
    if (isTikTokSoundPageUrl(rawUrl)) {
      return "sound_page";
    }
    if (extractTikTokPostId(rawUrl)) {
      return "video_post";
    }
    return "tiktok_reference";
  }

  function titleFromPathSegment(segment) {
    return decodeURIComponent(String(segment || "TikTok discovery"))
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractSoundPageFromEmbedHtml(html) {
    if (!html) {
      return null;
    }

    if (globalScope.document) {
      const template = globalScope.document.createElement("template");
      template.innerHTML = html;
      const soundLink = template.content.querySelector('a[href*="/music/"], a[href*="/sound/"]');
      return soundLink ? soundLink.href : null;
    }

    const match = String(html).match(/https:\/\/(?:www\.)?tiktok\.com\/(?:music|sound)\/[^"'<> ]+/i);
    return match ? match[0] : null;
  }

  function extractSoundNameFromEmbedHtml(html) {
    if (!html) {
      return "";
    }

    if (globalScope.document) {
      const template = globalScope.document.createElement("template");
      template.innerHTML = html;
      const soundLink = template.content.querySelector('a[href*="/music/"], a[href*="/sound/"]');
      return soundLink ? soundLink.textContent.trim() : "";
    }

    const match = String(html).match(/<a[^>]+href=["'][^"']*\/(?:music|sound)\/[^"']+["'][^>]*>(.*?)<\/a>/i);
    return match ? match[1].replace(/<[^>]*>/g, "").trim() : "";
  }

  function mapOEmbedToVideoReference(oembed, sourceUrl, options) {
    const now = (options && options.now) || new Date().toISOString();
    const id = (options && options.id) || createId("video");
    const embedHtml = oembed && oembed.html ? String(oembed.html) : "";

    return {
      id,
      provider: "tiktok",
      sourceUrl: normalizeTikTokUrl(sourceUrl),
      referenceKind: getTikTokReferenceKind(sourceUrl),
      tiktokPostId: extractTikTokPostId(sourceUrl),
      tiktokPlayerUrl: buildTikTokPlayerUrl(sourceUrl),
      title: (oembed && oembed.title) || "Untitled TikTok",
      authorName: (oembed && oembed.author_name) || "Unknown creator",
      authorUrl: (oembed && oembed.author_url) || "",
      thumbnailUrl: (oembed && oembed.thumbnail_url) || "assets/poster-wave.svg",
      thumbnailRefreshedAt: now,
      thumbnailExpiresAt: addHours(now, THUMBNAIL_TTL_HOURS),
      embedHtml,
      soundPageUrl: extractSoundPageFromEmbedHtml(embedHtml),
      soundName: extractSoundNameFromEmbedHtml(embedHtml),
      createdAt: now,
      updatedAt: now
    };
  }

  function buildReferenceItemFromUrl(rawUrl, options) {
    const now = (options && options.now) || new Date().toISOString();
    const sourceUrl = normalizeTikTokUrl(rawUrl);
    const parsed = new URL(sourceUrl);
    const titleSegment = parsed.pathname.split("/").filter(Boolean).slice(-1)[0] || "TikTok discovery";
    const referenceKind = getTikTokReferenceKind(sourceUrl);
    const title =
      referenceKind === "sound_page"
        ? `TikTok sound ${titleFromPathSegment(titleSegment)}`
        : extractTikTokPostId(sourceUrl)
          ? `TikTok video ${extractTikTokPostId(sourceUrl)}`
          : `Saved TikTok ${titleFromPathSegment(titleSegment)}`;

    return {
      id: (options && options.id) || createId("video"),
      provider: "tiktok",
      sourceUrl,
      referenceKind,
      tiktokPostId: extractTikTokPostId(sourceUrl),
      tiktokPlayerUrl: buildTikTokPlayerUrl(sourceUrl),
      title,
      authorName: referenceKind === "sound_page" ? "TikTok sound page" : "Unknown creator",
      authorUrl: "",
      thumbnailUrl: "assets/poster-wave.svg",
      thumbnailRefreshedAt: now,
      thumbnailExpiresAt: addHours(now, THUMBNAIL_TTL_HOURS),
      embedHtml: "",
      soundPageUrl: referenceKind === "sound_page" ? sourceUrl : null,
      soundName: referenceKind === "sound_page" ? titleFromPathSegment(titleSegment) : "",
      createdAt: now,
      updatedAt: now
    };
  }

  function createCanonicalSoundFromReference(videoReference, options) {
    const now = (options && options.now) || new Date().toISOString();
    const id = (options && options.id) || createId("sound");
    const sourceUrl = videoReference.soundPageUrl || videoReference.sourceUrl;

    return {
      id,
      displayName: (options && options.displayName) || videoReference.title || "Unmatched TikTok sound",
      sourceKind: videoReference.soundPageUrl ? "tiktok_sound_page" : "tiktok_video_reference",
      sourceUrl,
      artworkUrl: videoReference.thumbnailUrl,
      createdAt: now,
      updatedAt: now
    };
  }

  function createAudioVariant(videoReference, canonicalSoundId, options) {
    const now = (options && options.now) || new Date().toISOString();
    return {
      id: (options && options.id) || createId("variant"),
      videoReferenceId: videoReference.id,
      canonicalSoundId,
      playableAssetId: (options && options.playableAssetId) || null,
      rightsRecordId: (options && options.rightsRecordId) || null,
      confidence: (options && options.confidence) || 0.35,
      appearsEdited: Boolean(options && options.appearsEdited),
      loopMode: "whole",
      loopStartMs: 0,
      loopEndMs: 15000,
      loopCount: "infinite",
      notes: (options && options.notes) || "",
      tags: (options && options.tags) || [],
      liked: Boolean(options && options.liked),
      createdAt: now,
      updatedAt: now
    };
  }

  function createReferenceOnlyAsset(id, videoReference, now) {
    return {
      id,
      policy: PLAYABLE_POLICIES.REFERENCE_ONLY,
      referenceKind: videoReference.referenceKind || getTikTokReferenceKind(videoReference.sourceUrl),
      displayName: isTikTokSoundPageUrl(videoReference.sourceUrl) ? "TikTok sound page" : "TikTok reference",
      externalUrl: videoReference.sourceUrl,
      streamUrlAvailable: false,
      backgroundPlaybackAllowed: false,
      createdAt: now,
      updatedAt: now
    };
  }

  function createTikTokEmbedAsset(id, videoReference, now) {
    return {
      id,
      policy: PLAYABLE_POLICIES.TIKTOK_EMBED,
      referenceKind: "video_post",
      displayName: "TikTok embedded player",
      externalUrl: videoReference.sourceUrl,
      embedUrl: videoReference.tiktokPlayerUrl || buildTikTokPlayerUrl(videoReference.sourceUrl),
      streamUrlAvailable: false,
      backgroundPlaybackAllowed: false,
      createdAt: now,
      updatedAt: now
    };
  }

  function createReferenceOnlyRightsRecord(id, now) {
    return {
      id,
      status: RIGHTS_STATUS.REFERENCE_ONLY,
      licenseBasis: "link_reference",
      backgroundPlaybackAllowed: false,
      attributionRequired: true,
      takedownStatus: "none",
      territoryNotes: "Reference item only. Open playback at the source.",
      authorizationEvidence: "",
      createdAt: now,
      updatedAt: now
    };
  }

  function createTikTokEmbedRightsRecord(id, now) {
    return {
      id,
      status: RIGHTS_STATUS.CLEARED,
      licenseBasis: "tiktok_embed_player",
      backgroundPlaybackAllowed: false,
      attributionRequired: true,
      takedownStatus: "none",
      territoryNotes: "Whole-post playback through TikTok's embedded player only.",
      authorizationEvidence: "Official TikTok player URL generated from the post ID.",
      createdAt: now,
      updatedAt: now
    };
  }

  function hasClearedRights(rightsRecord) {
    return (
      rightsRecord &&
      rightsRecord.status === RIGHTS_STATUS.CLEARED &&
      rightsRecord.takedownStatus !== "disabled" &&
      rightsRecord.takedownStatus !== "removed"
    );
  }

  function evaluatePlaybackPolicy(playableAsset, rightsRecord, context) {
    const auth = context || {};
    const isSoundReference = playableAsset && playableAsset.referenceKind === "sound_page";
    const base = {
      canPlayInApp: false,
      canRouteOut: true,
      action: "open_original",
      label: isSoundReference ? "Listen on TikTok" : "Open original",
      reason: isSoundReference
        ? "TikTok sound-page links open on TikTok; no raw audio is stored."
        : "This saved item is a TikTok reference.",
      allowedLoopModes: ["whole_post"],
      severity: "reference"
    };

    if (!playableAsset || !rightsRecord) {
      return base;
    }

    if (rightsRecord.takedownStatus === "disabled" || rightsRecord.status === RIGHTS_STATUS.BLOCKED) {
      return {
        ...base,
        canRouteOut: false,
        action: "blocked",
        label: "Playback disabled",
        reason: "Playback has been disabled for this asset.",
        allowedLoopModes: [],
        severity: "blocked"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.REFERENCE_ONLY) {
      return base;
    }

    if (!hasClearedRights(rightsRecord)) {
      return {
        ...base,
        action: "needs_review",
        label: "Needs review",
        reason: "A rights record must be cleared before playback is available.",
        allowedLoopModes: [],
        severity: "review"
      };
    }

    if (!rightsRecord.backgroundPlaybackAllowed && playableAsset.backgroundPlaybackAllowed) {
      return {
        ...base,
        action: "needs_review",
        label: "Needs review",
        reason: "The asset allows playback, but the rights record does not allow background use.",
        allowedLoopModes: [],
        severity: "review"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.CREATOR_UPLOAD) {
      return {
        canPlayInApp: true,
        canRouteOut: false,
        action: "play_creator_upload",
        label: "Play",
        reason: "Creator-uploaded audio is cleared for in-app playback.",
        allowedLoopModes: ["whole", "clip"],
        severity: "playable"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.TIKTOK_EMBED) {
      return {
        canPlayInApp: true,
        canRouteOut: true,
        action: "play_tiktok_embed",
        label: "Play TikTok",
        reason: "Plays the whole TikTok post through TikTok's embedded player. No raw audio is stored.",
        allowedLoopModes: ["whole_post"],
        severity: "playable"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.APPLE_MUSIC) {
      if (!auth.appleMusicAuthorized && playableAsset.requiresUserSubscription) {
        return {
          ...base,
          action: "connect_apple_music",
          label: "Connect Apple Music",
          reason: "Apple Music playback requires a linked user subscription.",
          allowedLoopModes: ["whole"],
          severity: "handoff"
        };
      }
      return {
        canPlayInApp: true,
        canRouteOut: true,
        action: "play_apple_music",
        label: "Play in Apple Music",
        reason: "MusicKit can control playback for an authorized Apple Music item.",
        allowedLoopModes: ["whole"],
        severity: "playable"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.SOUNDCLOUD_STREAM) {
      if (!playableAsset.streamUrlAvailable) {
        return {
          ...base,
          action: "open_source_app",
          label: "Open SoundCloud",
          reason: "SoundCloud did not expose a playable stream for this track.",
          allowedLoopModes: [],
          severity: "handoff"
        };
      }
      return {
        canPlayInApp: true,
        canRouteOut: true,
        action: "play_soundcloud",
        label: "Play",
        reason: "The SoundCloud item is playable and attribution can be shown.",
        allowedLoopModes: ["whole", "clip"],
        severity: "playable"
      };
    }

    if (playableAsset.policy === PLAYABLE_POLICIES.SPOTIFY_HANDOFF) {
      return {
        ...base,
        action: "open_source_app",
        label: "Open Spotify",
        reason: "Spotify is routed through app handoff rather than standalone in-app streaming.",
        allowedLoopModes: [],
        severity: "handoff"
      };
    }

    return base;
  }

  function thumbnailRefreshNeeded(videoReference, now) {
    if (!videoReference || !videoReference.thumbnailExpiresAt) {
      return true;
    }
    return new Date(videoReference.thumbnailExpiresAt).getTime() <= new Date(now || Date.now()).getTime();
  }

  function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  const api = {
    PLAYABLE_POLICIES,
    RIGHTS_STATUS,
    addHours,
    buildReferenceItemFromUrl,
    createAudioVariant,
    createCanonicalSoundFromReference,
    createId,
    createReferenceOnlyAsset,
    createReferenceOnlyRightsRecord,
    createTikTokEmbedAsset,
    createTikTokEmbedRightsRecord,
    evaluatePlaybackPolicy,
    extractSoundPageFromEmbedHtml,
    extractSoundNameFromEmbedHtml,
    extractTikTokPostId,
    formatMs,
    buildTikTokPlayerUrl,
    getTikTokReferenceKind,
    isTikTokSoundPageUrl,
    mapOEmbedToVideoReference,
    normalizeTikTokUrl,
    thumbnailRefreshNeeded
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  globalScope.AudioLibraryDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : window);







