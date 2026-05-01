// Cortex CLI style helpers.
//
// Pure ANSI / Unicode utilities — no external deps. The brand language is:
//   GitHub CLI meets cyberpunk compliance system.
//   Dark background, neon gradient (purple → indigo → blue → cyan), thin lines,
//   subtle motion. "Cortex is in control."
//
// Every helper degrades to plain text when:
//   - process.stdout.isTTY is false (piped, CI, file redirect), or
//   - NO_COLOR is set (https://no-color.org/), or
//   - CORTEX_NO_COLOR is set (escape hatch).
//
// Unicode glyphs degrade to ASCII when CORTEX_NO_UNICODE is set or LANG/LC_ALL
// look non-UTF-8.

const NO_COLOR =
  typeof process.env.NO_COLOR === "string" && process.env.NO_COLOR.length > 0;
const CORTEX_NO_COLOR =
  typeof process.env.CORTEX_NO_COLOR === "string" &&
  process.env.CORTEX_NO_COLOR.length > 0;

function streamSupportsColor(stream) {
  if (NO_COLOR || CORTEX_NO_COLOR) return false;
  if (!stream) return false;
  if (stream.isTTY === false) return false;
  if (process.env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}

export function supportsColor(stream = process.stdout) {
  return streamSupportsColor(stream);
}

function unicodeOk() {
  if (process.env.CORTEX_NO_UNICODE) return false;
  const locale =
    process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  if (!locale) return process.platform !== "win32";
  return /UTF-?8/i.test(locale);
}

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const DIM = `${ESC}2m`;
const BOLD = `${ESC}1m`;

// Cortex neon palette (256-color). Picked from xterm-256 to read as
// purple → indigo → blue → cyan on a dark terminal.
const GRADIENT_COLORS = [
  141, // light purple
  99, // indigo
  63, // deep indigo / blue
  69, // mid blue
  75, // bright blue
  81, // cyan-blue
  45, // cyan
  51 // bright cyan
];

const SEMANTIC = {
  ok: 84, // green
  warn: 215, // amber
  fail: 203, // red
  info: 81, // cyan
  alert: 197, // hot pink-red (cyberpunk alert)
  muted: 244 // soft grey
};

function fg256(code) {
  return `${ESC}38;5;${code}m`;
}

function colorize(text, code, stream = process.stdout) {
  if (!supportsColor(stream)) return text;
  return `${fg256(code)}${text}${RESET}`;
}

export function dim(text, stream = process.stdout) {
  if (!supportsColor(stream)) return text;
  return `${DIM}${text}${RESET}`;
}

export function bold(text, stream = process.stdout) {
  if (!supportsColor(stream)) return text;
  return `${BOLD}${text}${RESET}`;
}

export function muted(text, stream = process.stdout) {
  return colorize(text, SEMANTIC.muted, stream);
}

export function accent(text, stream = process.stdout) {
  return colorize(text, SEMANTIC.info, stream);
}

// Render text letter-by-letter through the neon gradient. Whitespace is
// preserved verbatim so layout stays aligned.
export function gradient(text, stream = process.stdout) {
  if (!supportsColor(stream)) return text;
  const chars = [...text];
  const visible = chars.filter((ch) => ch.trim().length > 0).length;
  if (visible === 0) return text;

  let visibleIndex = 0;
  let out = "";
  for (const ch of chars) {
    if (ch.trim().length === 0) {
      out += ch;
      continue;
    }
    const t = visible === 1 ? 0 : visibleIndex / (visible - 1);
    const slot = Math.min(
      GRADIENT_COLORS.length - 1,
      Math.round(t * (GRADIENT_COLORS.length - 1))
    );
    out += `${fg256(GRADIENT_COLORS[slot])}${ch}${RESET}`;
    visibleIndex += 1;
  }
  return out;
}

const BULLET_GLYPHS_UTF8 = {
  ok: "✔",
  warn: "!",
  fail: "✗",
  info: "▸",
  alert: "●"
};

const BULLET_GLYPHS_ASCII = {
  ok: "v",
  warn: "!",
  fail: "x",
  info: ">",
  alert: "*"
};

function bulletGlyph(state) {
  const map = unicodeOk() ? BULLET_GLYPHS_UTF8 : BULLET_GLYPHS_ASCII;
  return map[state] ?? map.info;
}

export function bullet(state, text, stream = process.stdout) {
  const glyph = bulletGlyph(state);
  const code = SEMANTIC[state] ?? SEMANTIC.info;
  if (!supportsColor(stream)) {
    return `${glyph} ${text}`;
  }
  return `${fg256(code)}${glyph}${RESET} ${text}`;
}

export function printBullet(state, text, stream = process.stdout) {
  stream.write(`${bullet(state, text, stream)}\n`);
}

// Spinner: Braille pattern in UTF-8 mode, ASCII clock fallback otherwise.
const SPINNER_FRAMES_UTF8 = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAMES_ASCII = ["|", "/", "-", "\\"];

function spinnerFrames() {
  return unicodeOk() ? SPINNER_FRAMES_UTF8 : SPINNER_FRAMES_ASCII;
}

// Returns a controller: { stop(finalState, finalText), update(text) }.
// In non-TTY mode the spinner just writes the static label as a "▸ label"
// info bullet and returns a no-op stop().
export function spinner(label, stream = process.stdout) {
  const useTTY = supportsColor(stream) && Boolean(stream.isTTY);
  const frames = spinnerFrames();
  let i = 0;
  let currentLabel = label;

  if (!useTTY) {
    stream.write(`${bullet("info", currentLabel, stream)}\n`);
    return {
      update(next) {
        currentLabel = next;
      },
      stop(finalState = "ok", finalText) {
        const text = finalText ?? currentLabel;
        stream.write(`${bullet(finalState, text, stream)}\n`);
      }
    };
  }

  const hideCursor = `${ESC}?25l`;
  const showCursor = `${ESC}?25h`;
  const clearLine = `\r${ESC}2K`;

  stream.write(hideCursor);
  const render = () => {
    const frame = frames[i % frames.length];
    i += 1;
    stream.write(`${clearLine}${fg256(SEMANTIC.info)}${frame}${RESET} ${currentLabel}`);
  };
  render();
  const interval = setInterval(render, 80);
  if (typeof interval.unref === "function") {
    interval.unref();
  }

  let stopped = false;
  return {
    update(next) {
      currentLabel = next;
    },
    stop(finalState = "ok", finalText) {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      const text = finalText ?? currentLabel;
      stream.write(`${clearLine}${bullet(finalState, text, stream)}\n${showCursor}`);
    }
  };
}

// Box-drawing wrapper. UTF-8: rounded corners + thin lines. ASCII fallback uses
// + - | corners. Optional title and accent color (256-color code).
const BOX_UTF8 = {
  tl: "╭",
  tr: "╮",
  bl: "╰",
  br: "╯",
  h: "─",
  v: "│"
};
const BOX_ASCII = {
  tl: "+",
  tr: "+",
  bl: "+",
  br: "+",
  h: "-",
  v: "|"
};

function visibleLength(line) {
  // strip ANSI escapes for width calculation
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padRight(line, width) {
  const len = visibleLength(line);
  if (len >= width) return line;
  return line + " ".repeat(width - len);
}

export function box(content, opts = {}) {
  const stream = opts.stream ?? process.stdout;
  const useColor = supportsColor(stream);
  const glyphs = unicodeOk() ? BOX_UTF8 : BOX_ASCII;
  const accentCode = opts.accent ?? GRADIENT_COLORS[2];
  const tint = (text) => (useColor ? `${fg256(accentCode)}${text}${RESET}` : text);

  const lines = String(content).split("\n");
  const titleRaw = opts.title ?? "";
  const padding = opts.padding ?? 1;

  const inner = Math.max(
    visibleLength(titleRaw) + 4,
    ...lines.map(visibleLength)
  );
  const width = inner + padding * 2;

  let topMid = glyphs.h.repeat(width);
  if (titleRaw) {
    const titleText = useColor ? bold(titleRaw, stream) : titleRaw;
    const lhs = glyphs.h.repeat(2);
    const rhs = glyphs.h.repeat(Math.max(1, width - visibleLength(titleRaw) - 4));
    topMid = `${lhs} ${titleText} ${rhs}`;
  }

  const top = tint(`${glyphs.tl}${topMid}${glyphs.tr}`);
  const bottom = tint(`${glyphs.bl}${glyphs.h.repeat(width)}${glyphs.br}`);
  const pad = " ".repeat(padding);

  const body = lines.map(
    (line) => `${tint(glyphs.v)}${pad}${padRight(line, inner)}${pad}${tint(glyphs.v)}`
  );

  return [top, ...body, bottom].join("\n");
}

// Header banner: stylized CORTEX wordmark + a "node network" motif.
// The motif is a thin row of dot-and-line glyphs framing a central core dot —
// the same idea as the orbiting nodes in the brand brief, reduced to one line.
//
// Wordmark uses block characters that fit ~6 lines tall, kept narrow so it
// doesn't wrap on 80-col terminals.
const CORTEX_WORDMARK = [
  "  ██████╗ ██████╗ ██████╗ ████████╗███████╗██╗  ██╗",
  " ██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔════╝╚██╗██╔╝",
  " ██║     ██║   ██║██████╔╝   ██║   █████╗   ╚███╔╝ ",
  " ██║     ██║   ██║██╔══██╗   ██║   ██╔══╝   ██╔██╗ ",
  " ╚██████╗╚██████╔╝██║  ██║   ██║   ███████╗██╔╝ ██╗",
  "  ╚═════╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═╝  ╚═╝"
];

const CORTEX_WORDMARK_ASCII = [
  "  CCCCC   OOO   RRRR  TTTTT EEEEE X   X",
  " C       O   O  R   R   T   E      X X ",
  " C       O   O  RRRR    T   EEEE    X  ",
  " C       O   O  R  R    T   E      X X ",
  "  CCCCC   OOO   R   R   T   EEEEE X   X"
];

function networkMotif(width) {
  if (!unicodeOk()) {
    const dots = ".".repeat(Math.max(0, Math.floor((width - 7) / 2)));
    return `${dots} [ core ] ${dots}`;
  }
  const dots = "·".repeat(Math.max(0, Math.floor((width - 7) / 2)));
  // ⟢ / ⟣ are subtle "incoming/outgoing" arrows around a core node ◉.
  return `${dots} ⟢ ◉ ⟣ ${dots}`;
}

export function headerBanner(opts = {}) {
  const stream = opts.stream ?? process.stdout;
  const tagline = opts.tagline ?? "";
  const wordmark = unicodeOk() ? CORTEX_WORDMARK : CORTEX_WORDMARK_ASCII;
  const width = Math.max(...wordmark.map((line) => line.length));

  const lines = [];
  lines.push("");
  for (const line of wordmark) {
    lines.push(gradient(line, stream));
  }
  const motif = networkMotif(width);
  lines.push(muted(motif, stream));
  if (tagline) {
    lines.push(muted(tagline, stream));
  }
  lines.push("");
  return lines.join("\n");
}

export function printHeaderBanner(opts = {}) {
  const stream = opts.stream ?? process.stdout;
  stream.write(headerBanner(opts));
}

// Convenience: compose a labelled status line (used by `cortex run` header).
export function runHeader(label, stream = process.stdout) {
  const glyph = unicodeOk() ? "▸" : ">";
  if (!supportsColor(stream)) {
    return `${glyph} ${label}`;
  }
  return `${fg256(SEMANTIC.info)}${glyph}${RESET} ${label}`;
}
