import * as path from 'path';
import * as fs from 'fs';

import { PerFileCompileRecord } from './qtBuildAnalytics';

interface LogEntry {
    ts: number;
    line: string;
}

const SOURCE_EXTS = ['.cpp', '.cc', '.cxx', '.c++'];

/**
 * Parse per-file compile timing from a structured build log and the build directory.
 *
 * Strategy:
 * 1. If <buildDir>/.ninja_log exists, use it (CMake+Ninja, accurate).
 * 2. Otherwise, fall back to heuristics on the structured log (verbose make/MSVC output).
 */
export function parseBuildLog(logPath: string, buildDir: string): PerFileCompileRecord[] {
    const ninjaRecords = parseNinjaLog(buildDir);
    if (ninjaRecords.length > 0) {
        return ninjaRecords;
    }
    return parseStructuredLog(logPath);
}

/**
 * Parse .ninja_log produced by the Ninja build system.
 */
export function parseNinjaLog(buildDir: string): PerFileCompileRecord[] {
    const logPath = path.join(buildDir, '.ninja_log');
    if (!fs.existsSync(logPath)) {
        return [];
    }

    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        const lines = content.split('\n');
        const durations = new Map<string, number>();

        for (const line of lines) {
            if (!line || line.startsWith('#')) { continue; }
            const parts = line.split('\t');
            if (parts.length < 5) { continue; }

            const startTime = parseInt(parts[0], 10);
            const endTime = parseInt(parts[1], 10);
            if (isNaN(startTime) || isNaN(endTime)) { continue; }

            const outputPath = parts[4];
            const sourcePath = inferSourcePath(outputPath);
            if (!sourcePath) { continue; }

            const duration = endTime - startTime;
            // Keep the longest duration seen for a source file in this build.
            const existing = durations.get(sourcePath) ?? 0;
            if (duration > existing) {
                durations.set(sourcePath, duration);
            }
        }

        const records: PerFileCompileRecord[] = [];
        for (const [filePath, durationMs] of durations.entries()) {
            records.push({ filePath, durationMs });
        }
        return records;
    } catch {
        return [];
    }
}

/**
 * Fallback heuristic parser for verbose build output.
 *
 * Looks for lines that indicate a source file is being compiled and measures the
 * time until the next such line. This is approximate and works best for serial
 * or lightly parallel builds with verbose output enabled.
 */
function parseStructuredLog(logPath: string): PerFileCompileRecord[] {
    if (!fs.existsSync(logPath)) {
        return [];
    }

    const entries: LogEntry[] = [];
    try {
        const content = fs.readFileSync(logPath, 'utf-8');
        for (const raw of content.split('\n')) {
            if (!raw.trim()) { continue; }
            try {
                entries.push(JSON.parse(raw) as LogEntry);
            } catch {
                // Ignore malformed lines.
            }
        }
    } catch {
        return [];
    }

    const compileStarts: { filePath: string; ts: number }[] = [];

    for (const entry of entries) {
        const match = matchCompileLine(entry.line);
        if (match) {
            compileStarts.push({ filePath: match, ts: entry.ts });
        }
    }

    const durations = new Map<string, number>();
    for (let i = 0; i < compileStarts.length; i++) {
        const current = compileStarts[i];
        const next = compileStarts[i + 1];
        const endTs = next ? next.ts : current.ts;
        const duration = Math.max(0, endTs - current.ts);
        const existing = durations.get(current.filePath) ?? 0;
        if (duration > existing) {
            durations.set(current.filePath, duration);
        }
    }

    const records: PerFileCompileRecord[] = [];
    for (const [filePath, durationMs] of durations.entries()) {
        records.push({ filePath, durationMs });
    }
    return records;
}

/**
 * Try to identify a source file path from a build output line.
 */
function matchCompileLine(line: string): string | undefined {
    // CMake verbose Make/Ninja: [ 12%] Building CXX object .../file.cpp.o
    const cmakeMatch = line.match(/Building\s+CXX\s+object\s+\S*?([^/\\\s]+\.cpp)\.o/i);
    if (cmakeMatch) {
        return cmakeMatch[1];
    }

    // Direct compiler invocation containing an absolute/relative .cpp file
    for (const ext of SOURCE_EXTS) {
        const regex = new RegExp(`(["']?[\\/\\.\w\-]+${ext.replace('.', '\\.')})["']?`, 'i');
        const match = line.match(regex);
        if (match) {
            return match[1].replace(/["']/g, '');
        }
    }

    return undefined;
}

/**
 * Map a build output path (e.g., .o/.obj) back to its source file path.
 */
function inferSourcePath(outputPath: string): string | undefined {
    const ext = path.extname(outputPath).toLowerCase();
    const base = outputPath.replace(/\.obj\.d?$|\.obj$|\.o$|\.lo$/i, '');
    if (base === outputPath) {
        // Not a compiled object we recognize.
        return undefined;
    }

    // Prefer the extension that exists on disk, otherwise default to .cpp.
    for (const srcExt of SOURCE_EXTS) {
        const candidate = base + srcExt;
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return base + '.cpp';
}
