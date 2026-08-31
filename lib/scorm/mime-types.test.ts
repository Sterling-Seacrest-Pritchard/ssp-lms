import { describe, it, expect } from "vitest";
import { mimeTypeForPath, DEFAULT_MIME_TYPE } from "./mime-types";

describe("mimeTypeForPath", () => {
  it("resolves common web asset extensions already covered", () => {
    expect(mimeTypeForPath("index.html")).toBe("text/html");
    expect(mimeTypeForPath("app.js")).toBe("text/javascript");
    expect(mimeTypeForPath("main.css")).toBe("text/css");
    expect(mimeTypeForPath("photo.png")).toBe("image/png");
  });

  it("resolves font extensions - real gap found testing a real Storyline package", () => {
    // 03_scorm2004_multisco and a real downloaded Storyline sample both
    // shipped .woff files (the legacy sample used a pre-rendered-image
    // fallback so it never actually loaded them, but a modern Storyline
    // 360 HTML5 export uses live webfonts, not baked images).
    expect(mimeTypeForPath("fonts/open-sans-regular.woff")).toBe("font/woff");
    expect(mimeTypeForPath("fonts/open-sans-bold.ttf")).toBe("font/ttf");
    expect(mimeTypeForPath("fonts/icons.otf")).toBe("font/otf");
    expect(mimeTypeForPath("fonts/legacy.eot")).toBe("application/vnd.ms-fontobject");
  });

  it("resolves audio/video extensions beyond mp4", () => {
    expect(mimeTypeForPath("narration.mp3")).toBe("audio/mpeg");
    expect(mimeTypeForPath("narration.wav")).toBe("audio/wav");
    expect(mimeTypeForPath("clip.webm")).toBe("video/webm");
  });

  it("resolves remaining common asset extensions", () => {
    expect(mimeTypeForPath("hero.webp")).toBe("image/webp");
    expect(mimeTypeForPath("favicon.ico")).toBe("image/x-icon");
    expect(mimeTypeForPath("readme.txt")).toBe("text/plain");
    expect(mimeTypeForPath("captions.vtt")).toBe("text/vtt");
  });

  it("falls back to application/octet-stream for unknown extensions", () => {
    expect(mimeTypeForPath("data.bin")).toBe(DEFAULT_MIME_TYPE);
  });

  it("falls back to application/octet-stream for paths with no extension", () => {
    expect(mimeTypeForPath("story_content/no_extension_here")).toBe(DEFAULT_MIME_TYPE);
  });
});
