import { spawn, exec } from "child_process";
import { getGuiPath, getTeaPath } from "./tea-dir";
import fs from "fs";
import path from "path";
import { initializeTeaCli } from "./initialize";

import { app } from "electron";
import log from "./logger";
import { MainWindowNotifier } from "./types";

// Be careful with globbing when passing this to a shell which might expand it.  Either escape it or quote it.
export const cliBinPath = path.join(getTeaPath(), "tea.xyz/v*/bin/tea");

export async function installPackage(
  full_name: string,
  version: string,
  notifyMainWindow: MainWindowNotifier
) {
  const teaVersion = await initializeTeaCli();
  const progressNotifier = newInstallProgressNotifier(full_name, notifyMainWindow);

  if (!teaVersion) throw new Error("no tea");

  const qualifedPackage = `${full_name}@${version}`;

  log.info(`installing package ${qualifedPackage}`);

  let stdout = "";
  let stderr = "";

  await new Promise((resolve, reject) => {
    // tea requires HOME to be set.
    const opts = { env: { HOME: app.getPath("home"), NO_COLOR: "1" } };

    const child = spawn(
      cliBinPath,
      ["--env=false", "--sync", "--json", `+${qualifedPackage}`],
      opts
    );

    child.stdout.on("data", (data) => {
      stdout += data.toString().trim();
    });

    child.stderr.on("data", (data) => {
      try {
        data
          .toString()
          .split("\n")
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 0)
          .forEach((line) => {
            try {
              const msg = JSON.parse(line.trim());
              progressNotifier(msg);
            } catch (err) {
              log.error("handling cli notification line", line, err);
            }
          });

        stderr += data.toString();
      } catch (err) {
        log.error("error processing cli data", data.toString(), err);
      }
    });

    child.on("exit", (code) => {
      log.info("cli exited with code:", code);
      log.info("cli stdout:", stdout);
      if (code !== 0) {
        log.info("cli stderr:", stderr);
        reject(new Error("tea exited with non-zero code: " + code));
      } else {
        resolve(null);
      }
    });

    child.on("error", () => {
      reject(new Error(stderr));
    });
  });
}

// This is hacky and kind of complex because of the output we get from the CLI.  When the CLI
// gives better output this definitely should get looked at.
function newInstallProgressNotifier(full_name: string, notifyMainWindow: MainWindowNotifier) {
  // the install progress is super spammy, only send every 10th update
  let counter = 0;

  // the totall number of packages to install - this is set by the "resolved" message
  let numberOfPackages = 1;

  // the current package number - this is incremented by the "installed" or "downloaded" message
  let currentPackageNumber = 0;

  return function (msg: any) {
    if (msg.status !== "downloading" && msg.status !== "installing") {
      log.info("cli:", msg);
    }

    if (msg.status === "resolved") {
      numberOfPackages = msg.pkgs?.length ?? 1;
      log.info(`installing ${numberOfPackages} packages`);
    } else if (msg.status === "downloading") {
      counter++;
      if (counter % 10 !== 0) return;

      const { received = 0, "content-size": contentSize = 0 } = msg;
      if (contentSize > 0) {
        // how many total pacakges are completed
        const overallProgress = (currentPackageNumber / numberOfPackages) * 100;
        // how much of the current package is completed
        const packageProgress = (received / contentSize) * 100;
        // progress is the total packages completed plus the percentage of the current package
        const progress = overallProgress + packageProgress / numberOfPackages;
        notifyMainWindow("install-progress", { full_name, progress });
      }
    } else if (msg.status === "installed") {
      currentPackageNumber++;
      const progress = (currentPackageNumber / numberOfPackages) * 100;
      notifyMainWindow("install-progress", { full_name, progress });
      notifyPackageInstalled(msg.pkg, notifyMainWindow);
    }
  };
}

const notifyPackageInstalled = (rawPkg: string, notifyMainWindow: MainWindowNotifier) => {
  try {
    const [full_name, version] = rawPkg.split("=");
    notifyMainWindow("pkg-installed", { full_name, version });
  } catch (err) {
    log.error("failed to notify package installed", err);
  }
};

export async function openPackageEntrypointInTerminal(pkg: string) {
  let sh = `"${cliBinPath}" --sync --env=false +${pkg} `;
  switch (pkg) {
    case "github.com/AUTOMATIC1111/stable-diffusion-webui":
      sh += `~/.tea/${pkg}/v*/entrypoint.sh`;
      break;
    case "cointop.sh":
      sh += "cointop";
      break;
    default:
      sh += "sh";
  }

  const scriptPath = await createCommandScriptFile(sh);

  try {
    let stdout = "";
    let stderr = "";

    await new Promise((resolve, reject) => {
      const child = spawn("/usr/bin/osascript", [scriptPath]);
      child.stdout.on("data", (data) => {
        stdout += data.toString().trim();
      });
      child.stderr.on("data", (data) => {
        stderr += data.toString().trim();
      });

      child.on("exit", (code) => {
        log.info("exit:", code, `\`${stdout}\``);
        if (code == 0) {
          resolve(stdout);
        } else {
          reject(new Error("failed to open terminal and run tea sh"));
        }
      });

      child.on("error", () => {
        reject(new Error(stderr));
      });
    });
  } finally {
    if (scriptPath) await fs.unlinkSync(scriptPath);
  }
}

const createCommandScriptFile = async (cmd: string): Promise<string> => {
  const guiFolder = getGuiPath();
  const tmpFilePath = path.join(guiFolder, `${+new Date()}.scpt`);
  const command = `${cmd.replace(/"/g, '\\"')}`;
  const script = `
    tell application "Terminal"
      activate
      do script "${command}"
    end tell
  `.trim();

  await fs.writeFileSync(tmpFilePath, script, "utf-8");
  return tmpFilePath;
};

export async function asyncExec(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout) => {
      if (err) {
        console.log("err:", err);
        reject(err);
        return;
      }
      console.log("stdout:", stdout);
      resolve(stdout);
    });
  });
}

export async function syncPantry() {
  const teaVersion = await initializeTeaCli();

  if (!teaVersion) throw new Error("no tea");
  log.info("Syncing pantry", teaVersion);
  await asyncExec(`DEBUG=1 "${cliBinPath}" --sync --env=false`);
}
