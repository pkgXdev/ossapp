import fs from "fs";
import path from "path";
import { app } from "electron";
import log from "./logger";
import type { InstalledPackage } from "../../src/libs/types";
import { mkdirp } from "mkdirp";
import fetch from "node-fetch";
import { SemVer, isValidSemVer } from "@tea/libtea";
import { execSync } from "child_process";
import chokidar from "chokidar";
import { MainWindowNotifier } from "./types";

type ParsedVersion = { full_name: string; semVer: SemVer };

export const getTeaPath = () => {
  const homePath = app.getPath("home");
  let teaPath;

  try {
    teaPath = execSync("tea --prefix", { encoding: "utf8" }).trim();
    log.info(teaPath);
  } catch (error) {
    log.info("Could not run tea --prefix. Using default path.");
    teaPath = path.join(homePath, "./.tea");
  }

  return teaPath;
};

const guiFolder = path.join(getTeaPath(), "tea.xyz/gui");

export const getGuiPath = () => {
  return path.join(getTeaPath(), "tea.xyz/gui");
};

export async function getInstalledVersionsForPackage(fullName: string): Promise<InstalledPackage> {
  const pkgsPath = path.join(getTeaPath(), fullName);
  const result = await findInstalledVersions(pkgsPath);
  const pkg = result.find((v) => v.full_name === fullName);
  return pkg ?? { full_name: fullName, installed_versions: [] };
}

export async function getInstalledPackages(): Promise<InstalledPackage[]> {
  return findInstalledVersions(getTeaPath());
}

async function findInstalledVersions(pkgsPath: string): Promise<InstalledPackage[]> {
  if (!fs.existsSync(pkgsPath)) {
    log.info(`packages path ${pkgsPath} does not exist, no installed packages`);
    return [];
  }

  log.info("recursively reading:", pkgsPath);
  const folders = await deepReadDir({
    dir: pkgsPath,
    continueDeeper: (name: string) => !isValidSemVer(name) && name !== ".tea",
    filter: (name: string) => !!isValidSemVer(name) && name !== ".tea"
  });

  const bottles = folders
    .map((p: string) => p.split(".tea/")[1])
    .map(parseVersionFromPath)
    .filter((v): v is ParsedVersion => !!v)
    .sort((a, b) => b.semVer.compare(a.semVer));

  log.info("installed bottles:", bottles.length);

  return bottles.reduce<InstalledPackage[]>((pkgs, bottle) => {
    const pkg = pkgs.find((v) => v.full_name === bottle.full_name);
    if (pkg) {
      pkg.installed_versions.push(bottle.semVer.toString());
    } else {
      pkgs.push({
        full_name: bottle.full_name,
        installed_versions: [bottle.semVer.toString()]
      });
    }
    return pkgs;
  }, []);
}

const parseVersionFromPath = (versionPath: string): ParsedVersion | null => {
  try {
    const path = versionPath.trim().split("/");
    const version = path.pop();
    return {
      semVer: new SemVer(version ?? ""),
      full_name: path.join("/")
    };
  } catch (e) {
    log.error("error parsing version from path: ", versionPath);
    return null;
  }
};

export const deepReadDir = async ({
  dir,
  continueDeeper,
  filter
}: {
  dir: string;
  continueDeeper?: (name: string) => boolean;
  filter?: (name: string) => boolean;
}) => {
  const arrayOfFiles: string[] = [];
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const f of files) {
      const nextPath = path.join(dir, f.name);
      const deeper = continueDeeper ? continueDeeper(f.name) : true;
      if (f.isDirectory() && deeper) {
        const nextFiles = await deepReadDir({ dir: nextPath, continueDeeper, filter });
        arrayOfFiles.push(...nextFiles);
      } else if (!f.isSymbolicLink() && filter && filter(f.name)) {
        arrayOfFiles.push(nextPath);
      } else if (!f.isSymbolicLink() && !filter) {
        arrayOfFiles.push(nextPath);
      }
    }
  } catch (e) {
    log.error(e);
  }
  return arrayOfFiles;
};

const listFilePath = path.join(getGuiPath(), "installed.json");
export const getPackagesInstalledList = async (): Promise<InstalledPackage[]> => {
  let list: InstalledPackage[] = [];
  try {
    if (fs.existsSync(listFilePath)) {
      log.info("gui/installed.json file exists!");
      const listBuffer = await fs.readFileSync(listFilePath);
      list = JSON.parse(listBuffer.toString()) as InstalledPackage[];
    } else {
      log.info("gui/installed.json does not exists!");
      await mkdirp(guiFolder);
      await updatePackageInstalledList([]);
    }
  } catch (error) {
    log.error(error);
  }
  return list;
};

export async function updatePackageInstalledList(list: InstalledPackage[]) {
  try {
    log.info("creating:", listFilePath);
    await mkdirp(guiFolder);
    await fs.writeFileSync(listFilePath, JSON.stringify(list), {
      encoding: "utf-8"
    });
  } catch (error) {
    log.error(error);
  }
}

export async function deletePackageFolder(fullName, version) {
  try {
    const foldPath = path.join(getTeaPath(), fullName, `v${version}`);
    log.info("rm:", foldPath);
    await fs.rmSync(foldPath, { recursive: true });
  } catch (error) {
    log.error(error);
  }
}

async function downloadImage(url: string, imagePath: string): Promise<void> {
  const response = await fetch(url);
  await new Promise<void>((resolve, reject) => {
    const fileStream = fs.createWriteStream(imagePath);
    response.body.pipe(fileStream);
    fileStream.on("finish", () => resolve());
    fileStream.on("error", (error) => reject(error));
  });
}

export async function cacheImage(url: string): Promise<string> {
  const imageFolder = path.join(getGuiPath(), "cached_images");
  const imageName = path.basename(url);
  const imagePath = path.join(imageFolder, imageName);

  await mkdirp(imageFolder);

  if (!fs.existsSync(imagePath)) {
    try {
      await downloadImage(url, imagePath);
      console.log("Image downloaded and cached:", imagePath);
    } catch (error) {
      console.error("Failed to download image:", error);
    }
  } else {
    console.log("Image already cached:", imagePath);
  }

  return `file://${imagePath}`;
}

let watcher: chokidar.FSWatcher | null = null;

export async function startMonitoringTeaDir(mainWindowNotifier: MainWindowNotifier) {
  if (watcher) {
    log.info("Watcher already started");
    return;
  }

  const dir = path.join(getTeaPath(), "**/v*");
  log.info(`Start monitoring tea dir: ${dir}}`);

  watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    depth: 5,
    ignored: ["**/var/pantry/projects/**", "**/local/tmp/**", "**/share/**"]
  });

  watcher
    .on("addDir", (pth) => {
      const dir = path.dirname(pth);
      const version = path.basename(pth);
      if (isValidSemVer(version) && !fs.lstatSync(pth).isSymbolicLink()) {
        const full_name = dir.split(".tea/")[1];
        log.info(`Monitor - Added Package: ${full_name} v${version}`);
        mainWindowNotifier("pkg-modified", { full_name, version, type: "add" });
      }
    })
    .on("unlinkDir", (pth) => {
      // FIXME: unlinkDir does not always fire, this is a bug in chokidar
      const dir = path.dirname(pth);
      const version = path.basename(pth);
      if (isValidSemVer(version)) {
        const full_name = dir.split(".tea/")[1];
        log.info(`Monitor - Removed Package: ${full_name} v${version}`);
        mainWindowNotifier("pkg-modified", { full_name, version, type: "remove" });
      }
    })
    .on("error", (error) => log.error(`Watcher error: ${error}`));
}

export async function stopMonitoringTeaDir() {
  log.info("Stop monitoring tea dir");
  await watcher?.close();
  watcher = null;
}
