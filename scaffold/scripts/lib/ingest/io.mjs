import fs from "node:fs";

export function writeJsonl(filePath, records) {
  const fd = fs.openSync(filePath, "w");
  try {
    for (const record of records) {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function stageJsonl(filePath, records) {
  const stagedPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeJsonl(stagedPath, records);
  return {
    commit() {
      fs.renameSync(stagedPath, filePath);
    },
    discard() {
      fs.rmSync(stagedPath, { force: true });
    }
  };
}

export function countFileContentRecords(fileRecords) {
  let count = 0;
  for (const fileRecord of fileRecords) {
    if (Object.prototype.hasOwnProperty.call(fileRecord, "content")) {
      count += 1;
    }
  }
  return count;
}

export function sanitizeTsvCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

export function writeTsv(filePath, headers, rows) {
  const fd = fs.openSync(filePath, "w");
  try {
    fs.writeSync(fd, `${headers.join("\t")}\n`, undefined, "utf8");
    for (const row of rows) {
      fs.writeSync(fd, `${row.map((value) => sanitizeTsvCell(value)).join("\t")}\n`, undefined, "utf8");
    }
  } finally {
    fs.closeSync(fd);
  }
}

export function* mapRows(records, project) {
  for (const record of records) {
    yield project(record);
  }
}

export function readJsonlSafe(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((record) => record !== null);
}
