import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

export interface IOSSigningIdentity {
    id: string;
    name: string;
}

export interface IOSProvisioningProfile {
    uuid: string;
    name: string;
    path: string;
    teamId?: string;
    appId?: string;
    expiresAt?: Date;
}

const PROVISIONING_PROFILES_DIR = path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles');

/**
 * Discovers code-signing identities from the macOS keychain.
 */
export function listSigningIdentities(): IOSSigningIdentity[] {
    try {
        const output = execSync('security find-identity -v -p codesigning', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const identities: IOSSigningIdentity[] = [];
        const regex = /^\s*\d+\)\s+([A-Fa-f0-9]+)\s+"(.+)"\s*$/gm;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(output)) !== null) {
            identities.push({ id: match[1], name: match[2] });
        }
        return identities;
    } catch {
        return [];
    }
}

/**
 * Discovers installed iOS provisioning profiles.
 */
export function listProvisioningProfiles(): IOSProvisioningProfile[] {
    if (!fs.existsSync(PROVISIONING_PROFILES_DIR)) {
        return [];
    }

    const profiles: IOSProvisioningProfile[] = [];
    const entries = fs.readdirSync(PROVISIONING_PROFILES_DIR);

    for (const entry of entries) {
        if (!entry.toLowerCase().endsWith('.mobileprovision')) { continue; }
        const fullPath = path.join(PROVISIONING_PROFILES_DIR, entry);
        const profile = parseProvisioningProfile(fullPath);
        if (profile) {
            profiles.push(profile);
        }
    }

    return profiles.sort((a, b) => (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0));
}

function parseProvisioningProfile(filePath: string): IOSProvisioningProfile | undefined {
    try {
        const decoded = execSync(`security cms -D -i "${filePath}" | plutil -p -`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });

        const uuidMatch = decoded.match(/"UUID"\s*=>\s*"([^"]+)"/);
        const nameMatch = decoded.match(/"Name"\s*=>\s*"([^"]+)"/);
        if (!uuidMatch || !nameMatch) { return undefined; }

        const teamMatch = decoded.match(/"TeamIdentifier"\s*=>\s*\[[\s\S]*?\d+\s*=>\s*"([^"]+)"/);

        const entitlementsMatch = decoded.match(/"Entitlements"\s*=>\s*\{([\s\S]*?)\n\s*\}/);
        let appId: string | undefined;
        if (entitlementsMatch) {
            const appIdMatch = entitlementsMatch[1].match(/"application-identifier"\s*=>\s*"([^"]+)"/);
            if (appIdMatch) { appId = appIdMatch[1]; }
        }

        const expirationMatch = decoded.match(/"ExpirationDate"\s*=>\s*"([^"]+)"/);
        let expiresAt: Date | undefined;
        if (expirationMatch) {
            const parsed = new Date(expirationMatch[1]);
            if (!isNaN(parsed.getTime())) { expiresAt = parsed; }
        }

        // Skip expired profiles.
        if (expiresAt && expiresAt.getTime() < Date.now()) {
            return undefined;
        }

        return {
            uuid: uuidMatch[1],
            name: nameMatch[1],
            path: filePath,
            teamId: teamMatch ? teamMatch[1] : undefined,
            appId,
            expiresAt
        };
    } catch {
        return undefined;
    }
}

function extractTeamIdFromIdentity(name: string): string | undefined {
    const match = name.match(/\(([A-Z0-9]+)\)\s*$/);
    return match ? match[1] : undefined;
}

/**
 * Present a QuickPick to select a signing identity and persist it in settings.
 */
export async function selectSigningIdentity(): Promise<void> {
    if (process.platform !== 'darwin') {
        void vscode.window.showErrorMessage('iOS signing is only available on macOS.');
        return;
    }

    const identities = listSigningIdentities();
    if (identities.length === 0) {
        void vscode.window.showWarningMessage('No iOS code-signing identities found in the keychain.');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        identities.map(i => ({
            label: i.name,
            description: i.id,
            identity: i
        })),
        { placeHolder: 'Select iOS signing identity' }
    );

    if (!selected) { return; }

    const config = vscode.workspace.getConfiguration('qt');
    await config.update('iosSigningIdentity', selected.identity.name, vscode.ConfigurationTarget.Workspace);

    const teamId = extractTeamIdFromIdentity(selected.identity.name);
    if (teamId) {
        await config.update('iosTeamId', teamId, vscode.ConfigurationTarget.Workspace);
    }

    void vscode.window.showInformationMessage(`iOS signing identity selected: ${selected.identity.name}`);
}

/**
 * Present a QuickPick to select a provisioning profile and persist it in settings.
 */
export async function selectProvisioningProfile(): Promise<void> {
    if (process.platform !== 'darwin') {
        void vscode.window.showErrorMessage('iOS signing is only available on macOS.');
        return;
    }

    const profiles = listProvisioningProfiles();
    if (profiles.length === 0) {
        void vscode.window.showWarningMessage('No iOS provisioning profiles found.');
        return;
    }

    const selected = await vscode.window.showQuickPick(
        profiles.map(p => ({
            label: p.name,
            description: `${p.uuid} • ${p.teamId ?? 'no team'} • expires ${p.expiresAt ? p.expiresAt.toLocaleDateString() : 'unknown'}`,
            profile: p
        })),
        { placeHolder: 'Select iOS provisioning profile' }
    );

    if (!selected) { return; }

    const config = vscode.workspace.getConfiguration('qt');
    await config.update('iosProvisioningProfile', selected.profile.uuid, vscode.ConfigurationTarget.Workspace);

    if (selected.profile.teamId) {
        await config.update('iosTeamId', selected.profile.teamId, vscode.ConfigurationTarget.Workspace);
    }

    void vscode.window.showInformationMessage(`iOS provisioning profile selected: ${selected.profile.name}`);
}

/**
 * Build xcodebuild signing arguments from current settings.
 */
export function getXcodebuildSigningArgs(): string {
    const config = vscode.workspace.getConfiguration('qt');
    const identity = config.get<string>('iosSigningIdentity') || '';
    const profile = config.get<string>('iosProvisioningProfile') || '';
    const team = config.get<string>('iosTeamId') || '';

    const args: string[] = [];
    if (identity) { args.push(`CODE_SIGN_IDENTITY="${identity}"`); }
    if (profile) { args.push(`PROVISIONING_PROFILE_SPECIFIER="${profile}"`); }
    if (team) { args.push(`DEVELOPMENT_TEAM="${team}"`); }
    return args.join(' ');
}

/**
 * Build an ExportOptions.plist string for IPA export.
 */
export function buildExportOptionsPlist(
    method: string,
    profileUuid: string,
    teamId: string,
    bundleId: string
): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>${escapeXml(method)}</string>
    <key>teamID</key>
    <string>${escapeXml(teamId)}</string>
    <key>provisioningProfiles</key>
    <dict>
        <key>${escapeXml(bundleId)}</key>
        <string>${escapeXml(profileUuid)}</string>
    </dict>
    <key>signingCertificate</key>
    <string>Apple Distribution</string>
    <key>stripSwiftSymbols</key>
    <false/>
    <key>thinning</key>
    <string>&lt;none&gt;</string>
</dict>
</plist>`;
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
