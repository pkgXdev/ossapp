/**
 * this is the main api integration, anything added here
 * should be mock replicated in ./mock.ts
 *  why? to make it easier to verify features without us always
 *    going through
 *      the build->download->install->test loop
 *      thus saving us so much time
 *
 * primary concerns here are any method that does the following:
 *  - connect to remote api(app.tea.xyz) and returns a data
 *  - connect to a local platform api and returns a data
 */

import type { Package, Review, AirtablePost, Bottle } from "@tea/ui/types";
import type { GUIPackage, Session, Packages, AutoUpdateStatus } from "./types";

import * as mock from "./native-mock";
import { PackageStates, type InstalledPackage } from "./types";

import { get as apiGet } from "$libs/v1-client";
import withRetry from "./utils/retry";
import log from "./logger";
const { ipcRenderer, shell } = window.require("electron");

export async function getDistPackages(): Promise<Package[]> {
  try {
    return withRetry(async () => {
      const packages = await apiGet<Package[]>("packages");
      log.info("packages received:", packages?.length);
      return packages || [];
    });
  } catch (error) {
    log.error("getDistPackagesList:", error);
    return [];
  }
}

export async function getInstalledPackages(): Promise<InstalledPackage[]> {
  let pkgs: InstalledPackage[] = [];
  try {
    log.info("getting installed packages");
    pkgs = (await ipcRenderer.invoke("get-installed-packages")) as InstalledPackage[];
    log.info("got installed packages:", pkgs.length);
  } catch (error) {
    log.error(error);
  }
  return pkgs;
}

export async function getInstalledVersionsForPackage(fullName: string): Promise<InstalledPackage> {
  log.info("getting installed versions for package: ", fullName);
  const result = await ipcRenderer.invoke("get-installed-package-versions", fullName);
  if (result instanceof Error) {
    throw result;
  }
  return result as InstalledPackage;
}

export async function getPackages(): Promise<GUIPackage[]> {
  const [packages, installedPackages] = await Promise.all([
    getDistPackages(),
    ipcRenderer.invoke("get-installed-packages") as InstalledPackage[]
  ]);

  // NOTE: its not ideal to get bottles or set package states here maybe do it async in the package store init
  // --- it has noticeable slowness
  log.info(`native: installed ${installedPackages.length} out of ${(packages || []).length}`);
  return (packages || []).map((pkg) => {
    const installedPkg = installedPackages.find((p) => p.full_name === pkg.full_name);
    return {
      ...pkg,
      state: installedPkg ? PackageStates.INSTALLED : PackageStates.AVAILABLE,
      installed_versions: installedPkg?.installed_versions || []
    };
  });
}

export async function getFeaturedPackages(): Promise<Package[]> {
  const packages = await mock.getFeaturedPackages();
  return packages;
}

export async function getPackageReviews(full_name: string): Promise<Review[]> {
  console.log(`getting reviews for ${full_name}`);
  const reviews: Review[] =
    (await apiGet<Review[]>(`packages/${full_name.replaceAll("/", ":")}/reviews`)) ?? [];

  return reviews;
}

export async function installPackage(pkg: GUIPackage, version?: string) {
  const latestVersion = pkg.version;
  const specificVersion = version || latestVersion;

  log.info(`installing package: ${pkg.name} version: ${specificVersion}`);

  const res = await ipcRenderer.invoke("install-package", {
    full_name: pkg.full_name,
    version: specificVersion
  });

  if (res instanceof Error) {
    throw res;
  }
}

export async function syncPantry() {
  const res = await ipcRenderer.invoke("sync-pantry");
  if (res instanceof Error) {
    throw res;
  }
}

export async function getTopPackages(): Promise<GUIPackage[]> {
  const packages = await mock.getTopPackages();
  return packages;
}

export async function getAllPosts(tag?: string): Promise<AirtablePost[]> {
  // add filter here someday: tag = news | course
  try {
    const queryParams = {
      ...(tag ? { tag } : {}),
      nocache: "true"
    };
    const posts = await apiGet<AirtablePost[]>("posts", queryParams);
    return posts || [];
  } catch (error) {
    log.error(error);
    return [];
  }
}

export async function getPackage(packageName: string): Promise<Partial<Package>> {
  try {
    return await withRetry(async () => {
      const data = await apiGet<Partial<Package>>(`packages/${packageName.replaceAll("/", ":")}`);
      log.info("package received:", data);
      if (data) {
        return data;
      } else {
        throw new Error(`package:${packageName} not found`);
      }
    });
  } catch (error) {
    log.error("getPackage:", error);
    return {};
  }
}

export const getSession = async (): Promise<Session | null> => {
  try {
    const session = await ipcRenderer.invoke("get-session");
    if (!session) throw new Error("no session found");
    return session;
  } catch (error) {
    log.error(error);
    return null;
  }
};

export const updateSession = async (session: Partial<Session>) => {
  try {
    await ipcRenderer.invoke("update-session", session);
  } catch (error) {
    log.error(error);
  }
};

export const openPackageEntrypointInTerminal = (pkg: string) => {
  try {
    ipcRenderer.invoke("open-terminal", { pkg });
  } catch (error) {
    log.error(error);
  }
};

export const shellOpenExternal = (link?: string) => {
  if (!link) {
    return;
  }
  shell.openExternal(link);
};

export const listenToChannel = (channel: string, callback: (data: any) => void) => {
  ipcRenderer.on(channel, (_: any, data: any) => callback(data));
};

export const relaunch = () => ipcRenderer.invoke("relaunch");

export const getProtocolPath = async (): Promise<string> => {
  const path = await ipcRenderer.invoke("get-protocol-path");
  return path;
};

export const submitLogs = async (): Promise<string> => {
  const response = await ipcRenderer.invoke("submit-logs");
  return response;
};

export const isPackageInstalled = async (fullName: string, version?: string): Promise<boolean> => {
  let isInstalled = false;
  const pkgs = await getInstalledPackages();
  const pkg = pkgs.find((p) => p.full_name === fullName);

  if (pkg) {
    isInstalled = true;
    if (version) {
      isInstalled = pkg.installed_versions.includes(version);
    }
  }

  return isInstalled;
};

export const setBadgeCount = async (count: number) => {
  try {
    await ipcRenderer.invoke("set-badge-count", { count });
  } catch (error) {
    log.error(error);
  }
};

export const deletePackage = async (args: { fullName: string; version: string }) => {
  const result = await ipcRenderer.invoke("delete-package", args);
  if (result instanceof Error) {
    throw result;
  }
};

export const loadPackageCache = async () => {
  try {
    return await ipcRenderer.invoke("load-package-cache");
  } catch (error) {
    log.error(error);
  }
};

export const writePackageCache = async (pkgs: Packages) => {
  try {
    await ipcRenderer.invoke("write-package-cache", pkgs);
  } catch (error) {
    log.error(error);
  }
};

export const topbarDoubleClick = async () => {
  try {
    ipcRenderer.invoke("topbar-double-click");
  } catch (error) {
    log.error(error);
  }
};

export const cacheImageURL = async (url: string): Promise<string | undefined> => {
  if (!url) return "";
  try {
    const cachedSrc = await ipcRenderer.invoke("cache-image", url);
    return cachedSrc;
  } catch (error) {
    log.error("Failed to cache image:", error);
  }
};

export const getAutoUpdateStatus = async (): Promise<AutoUpdateStatus> => {
  try {
    return await ipcRenderer.invoke("get-auto-update-status");
  } catch (error) {
    log.error(error);
    return { status: "up-to-date" };
  }
};

export const pollDeviceSession = async () => {
  try {
    await ipcRenderer.invoke("poll-session");
  } catch (error) {
    log.error(error);
  }
};

export const isDev = async () => {
  try {
    return await ipcRenderer.invoke("is-dev");
  } catch (error) {
    log.error(error);
    return false;
  }
};

export const monitorTeaDir = async () => {
  const result = await ipcRenderer.invoke("monitor-tea-dir");
  if (result instanceof Error) {
    throw result;
  }
};

export const stopMonitoringTeaDir = async () => {
  const result = await ipcRenderer.invoke("stop-monitor-tea-dir");
  if (result instanceof Error) {
    throw result;
  }
};

export const getHeaders = async (path: string) => {
  const headers = await ipcRenderer.invoke("get-api-headers", path);
  return (headers || {}) as { [key: string]: string };
};
