import { ipcMain, app, BrowserWindow } from "electron";
import { createReadStream, statSync } from "fs";
import { getInstalledPackages } from "./tea-dir";
import { readSessionData, writeSessionData } from "./auth";
import type { Packages, Session } from "../../src/libs/types";
import * as log from "electron-log";
import { post } from "./v1-client";
import { deepReadDir, deletePackageFolder } from "./tea-dir";
import path from "path";

import { installPackage, openTerminal } from "./cli";

import initializeTeaCli from "./initialize";

import { getUpdater } from "./auto-updater";
import fetch from "node-fetch";

import { loadPackageCache, writePackageCache } from "./package";
let teaProtocolPath = ""; // this should be empty string

export const setProtocolPath = (path: string) => {
	teaProtocolPath = path;
};

export default function initializeHandlers() {
	ipcMain.handle("get-installed-packages", async () => {
		try {
			log.info("getting installed packages");
			const pkgs = await getInstalledPackages();
			log.info(`got installed packages: ${pkgs.length}`);
			return pkgs;
		} catch (error) {
			log.error(error);
			return [];
		}
	});

	ipcMain.handle("get-session", async () => {
		try {
			log.info("getting session");
			const session = await readSessionData();
			log.debug(session ? "found session data" : "no session data found");
			return session;
		} catch (error) {
			log.error(error);
			return {};
		}
	});

	ipcMain.handle("update-session", async (_, data) => {
		try {
			log.info("updating session data with", data); // rm this
			await writeSessionData(data as Session);
		} catch (error) {
			log.error(error);
		}
	});

	ipcMain.handle("install-package", async (_, data) => {
		try {
			log.info("installing package:", data.full_name);
			const result = await installPackage(data.full_name);
			return result;
		} catch (error) {
			log.error(error);
			return error;
		}
	});

	ipcMain.handle("open-terminal", async (_, data) => {
		const { cmd } = data as { cmd: string };
		try {
			// TODO: detect if mac or linux
			// current openTerminal is only design for Mac
			log.info("open terminal w/ cmd:", cmd);
			await openTerminal(cmd);
		} catch (error) {
			log.error(error);
		}
	});

	ipcMain.handle("relaunch", async () => {
		try {
			const autoUpdater = getUpdater();
			await autoUpdater.quitAndInstall();
		} catch (error) {
			log.error(error);
		}
	});

	ipcMain.handle("get-protocol-path", async () => {
		const path = teaProtocolPath;
		teaProtocolPath = "";
		return path;
	});

	ipcMain.handle("submit-logs", async () => {
		try {
			log.info("syncing logs");
			const logDir = path.join(app.getPath("home"), "Library/Logs/tea");
			// ['/Users/neil/Library/Logs/tea/main.log']
			const logFiles = await deepReadDir({ dir: logDir });
			let deviceId = "";
			const files = logFiles.map((p) => {
				const paths = p.split("/");
				deviceId = paths[2]; // temp hack use developers username instead of gui_id
				return paths.pop();
			});

			const signedUrls = await post<{ [key: string]: string }>(`/gui/${deviceId}/sync-log-files`, {
				files
			});
			if (signedUrls) {
				for (const key in signedUrls) {
					const fileIndex = files.indexOf(key);
					const filePath = logFiles[fileIndex];
					if (filePath) {
						const payload = createReadStream(filePath);
						const response = await fetch(signedUrls[key], {
							method: "PUT",
							body: payload,
							headers: {
								"Content-Length": statSync(filePath).size.toString()
							}
						});
						log.info("uploading log:", key, response.status);
					}
				}
			}

			return `log files(${logFiles.length}) has been uploaded to S3 logs/${deviceId}`;
		} catch (error) {
			log.error(error);
			return error.message;
		}
	});

	ipcMain.handle("set-badge-count", async (_, { count }) => {
		console.log("set badge count:", count);
		if (count) {
			app.dock.setBadge(count.toString());
		} else {
			app.dock.setBadge("");
		}
	});

	ipcMain.handle(
		"delete-package",
		async (_, { fullName, version }: { fullName: string; version: string }) => {
			let error = "";
			try {
				log.info("deleting package:", fullName);
				await deletePackageFolder(fullName, version);
			} catch (e) {
				log.error(e);
				error = e.message;
			}
			return error;
		}
	);

	ipcMain.handle("write-package-cache", async (_, data) => {
		try {
			await writePackageCache(data as Packages);
		} catch (error) {
			log.error(error);
		}
	});

	ipcMain.handle("load-package-cache", async () => {
		try {
			return await loadPackageCache();
		} catch (error) {
			log.error(error);
			return { version: "1", packages: {} };
		}
	});

	ipcMain.handle("get-tea-version", async () => {
		try {
			log.info("installing tea cli");
			const version = await initializeTeaCli();
			if (!version) {
				throw new Error("failed to install tea cli");
			}

			return { version, message: "" };
		} catch (error) {
			log.error(error);
			return { version: "", message: error.message };
		}
	});

	ipcMain.handle("topbar-double-click", async (event: Electron.IpcMainInvokeEvent) => {
		const mainWindow = BrowserWindow.fromWebContents(event.sender);
		if (mainWindow) {
			mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
		}
	});
}
