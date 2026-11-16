// `npm run validate:data`: checks the Boston data files and exits with code 1 on any error (FR9.1, US6.4).
// Usage: tsx scripts/validate-data.ts [data-directory]   (defaults to backend/src/data)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkBostonData, formatDataIssues, type DataFileName } from '../src/lib/data-check.js';

export interface ValidateDataIo {
  readText: (filePath: string) => Promise<string>;
  log: (line: string) => void;
  error: (line: string) => void;
}

const defaultIo: ValidateDataIo = {
  readText: (filePath) => readFile(filePath, 'utf8'),
  log: (line) => console.log(line),
  error: (line) => console.error(line),
};

export const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data');

const FILES: DataFileName[] = ['places', 'transit', 'safety'];

/** Checks the data in `dataDir` and returns the process exit code: 0 when valid, 1 otherwise. */
export async function validateDataDirectory(dataDir: string, io: ValidateDataIo = defaultIo): Promise<number> {
  const raw: Record<DataFileName, unknown> = { places: undefined, transit: undefined, safety: undefined };
  const readErrors: string[] = [];
  for (const name of FILES) {
    const filePath = path.join(dataDir, `${name}.json`);
    try {
      raw[name] = JSON.parse(await io.readText(filePath));
    } catch (cause) {
      readErrors.push(`${name}.json: could not be read as JSON (${(cause as Error).message})`);
    }
  }
  if (readErrors.length > 0) {
    readErrors.forEach((line) => io.error(line));
    return 1;
  }
  const { issues, data } = checkBostonData(raw);
  if (!data) {
    io.error(`Boston data check failed with ${issues.length} error(s):`);
    formatDataIssues(issues).forEach((line) => io.error(`  ${line}`));
    return 1;
  }
  io.log(
    `Boston data OK: ${data.places.places.length} places, ${data.transit.network.stations.length} stations, ` +
      `${data.safety.safety.areas.length} safety areas.`,
  );
  if (data.places.sample || data.transit.sample || data.safety.sample) {
    io.log('WARNING: this is SAMPLE data that has not been hand-checked. Replace it before real use.');
  }
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  validateDataDirectory(process.argv[2] ?? DEFAULT_DATA_DIR).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(`validate-data failed: ${(error as Error).message}`);
      process.exitCode = 1;
    },
  );
}
