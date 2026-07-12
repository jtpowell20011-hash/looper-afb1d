"use strict";

const assert = require("node:assert/strict");
const Domain = require("../src/domain");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

test("reference-only assets never allow in-app playback", () => {
  const policy = Domain.evaluatePlaybackPolicy(
    {
      policy: Domain.PLAYABLE_POLICIES.REFERENCE_ONLY,
      backgroundPlaybackAllowed: false
    },
    {
      status: Domain.RIGHTS_STATUS.REFERENCE_ONLY,
      takedownStatus: "none",
      backgroundPlaybackAllowed: false
    }
  );

  assert.equal(policy.canPlayInApp, false);
  assert.equal(policy.action, "open_original");
  assert.deepEqual(policy.allowedLoopModes, ["whole_post"]);
});

test("creator uploads allow clip looping when cleared", () => {
  const policy = Domain.evaluatePlaybackPolicy(
    {
      policy: Domain.PLAYABLE_POLICIES.CREATOR_UPLOAD,
      backgroundPlaybackAllowed: true
    },
    {
      status: Domain.RIGHTS_STATUS.CLEARED,
      takedownStatus: "none",
      backgroundPlaybackAllowed: true
    }
  );

  assert.equal(policy.canPlayInApp, true);
  assert.equal(policy.action, "play_creator_upload");
  assert.deepEqual(policy.allowedLoopModes, ["whole", "clip"]);
});

test("SoundCloud routes fall back when no stream URL is exposed", () => {
  const policy = Domain.evaluatePlaybackPolicy(
    {
      policy: Domain.PLAYABLE_POLICIES.SOUNDCLOUD_STREAM,
      streamUrlAvailable: false,
      backgroundPlaybackAllowed: true
    },
    {
      status: Domain.RIGHTS_STATUS.CLEARED,
      takedownStatus: "none",
      backgroundPlaybackAllowed: true
    }
  );

  assert.equal(policy.canPlayInApp, false);
  assert.equal(policy.action, "open_source_app");
  assert.equal(policy.severity, "handoff");
});

test("Spotify routes are handoff only", () => {
  const policy = Domain.evaluatePlaybackPolicy(
    {
      policy: Domain.PLAYABLE_POLICIES.SPOTIFY_HANDOFF,
      backgroundPlaybackAllowed: false
    },
    {
      status: Domain.RIGHTS_STATUS.CLEARED,
      takedownStatus: "none",
      backgroundPlaybackAllowed: false
    }
  );

  assert.equal(policy.canPlayInApp, false);
  assert.equal(policy.action, "open_source_app");
  assert.equal(policy.label, "Open Spotify");
});

test("TikTok video links produce an embedded player route", () => {
  const url = "https://www.tiktok.com/@demo/video/7330000000000000099";
  assert.equal(Domain.extractTikTokPostId(url), "7330000000000000099");
  assert.equal(
    Domain.buildTikTokPlayerUrl(url),
    "https://www.tiktok.com/player/v1/7330000000000000099?controls=1&music_info=1&description=1&loop=1&rel=0"
  );

  const policy = Domain.evaluatePlaybackPolicy(
    {
      policy: Domain.PLAYABLE_POLICIES.TIKTOK_EMBED,
      backgroundPlaybackAllowed: false
    },
    {
      status: Domain.RIGHTS_STATUS.CLEARED,
      takedownStatus: "none",
      backgroundPlaybackAllowed: false
    }
  );

  assert.equal(policy.canPlayInApp, true);
  assert.equal(policy.action, "play_tiktok_embed");
  assert.deepEqual(policy.allowedLoopModes, ["whole_post"]);
});

test("TikTok sound-page links remain listen-on-TikTok references", () => {
  const videoReference = Domain.buildReferenceItemFromUrl("https://www.tiktok.com/music/demo-sound-123", {
    now: "2026-05-13T12:00:00.000Z",
    id: "sound-page"
  });
  const asset = Domain.createReferenceOnlyAsset("asset-sound-page", videoReference, "2026-05-13T12:00:00.000Z");
  const policy = Domain.evaluatePlaybackPolicy(asset, {
    status: Domain.RIGHTS_STATUS.REFERENCE_ONLY,
    takedownStatus: "none",
    backgroundPlaybackAllowed: false
  });

  assert.equal(videoReference.referenceKind, "sound_page");
  assert.equal(videoReference.soundPageUrl, "https://www.tiktok.com/music/demo-sound-123");
  assert.equal(policy.canPlayInApp, false);
  assert.equal(policy.label, "Listen on TikTok");
});

test("oEmbed mapper preserves attribution and sound links", () => {
  const mapped = Domain.mapOEmbedToVideoReference(
    {
      title: "Demo post",
      author_name: "Demo Creator",
      author_url: "https://www.tiktok.com/@demo",
      thumbnail_url: "https://example.test/thumb.jpg",
      html: '<blockquote><a href="https://www.tiktok.com/music/demo-sound-123">sound</a></blockquote>'
    },
    "https://www.tiktok.com/@demo/video/123",
    { now: "2026-05-13T12:00:00.000Z", id: "video-test" }
  );

  assert.equal(mapped.id, "video-test");
  assert.equal(mapped.authorName, "Demo Creator");
  assert.equal(mapped.soundPageUrl, "https://www.tiktok.com/music/demo-sound-123");
  assert.equal(mapped.thumbnailExpiresAt, "2026-05-13T18:00:00.000Z");
});

test("thumbnail refresh checks expiring TikTok covers", () => {
  assert.equal(
    Domain.thumbnailRefreshNeeded(
      { thumbnailExpiresAt: "2026-05-13T18:00:00.000Z" },
      "2026-05-13T18:00:00.000Z"
    ),
    true
  );
  assert.equal(
    Domain.thumbnailRefreshNeeded(
      { thumbnailExpiresAt: "2026-05-13T18:00:00.000Z" },
      "2026-05-13T17:59:59.000Z"
    ),
    false
  );
});
