import { writable } from "svelte/store";
import type { GUIPackage } from "../types";
import { getPackages } from "@native";
import Fuse from "fuse.js";
import { getPackage } from "@native";

import { getReadme, getContributors, getRepoAsPackage } from "$libs/github";

export default function initPackagesStore() {
	let initialized = false;
	const { subscribe, set, update } = writable<GUIPackage[]>([]);
	let teaPackage = writable<GUIPackage | null>(null);
	const packages: GUIPackage[] = [];
	let packagesIndex: Fuse<GUIPackage>;

	if (!initialized) {
		initialized = true;
		getPackages().then((pkgs) => {
			set(pkgs);
			packagesIndex = new Fuse(pkgs, {
				keys: ["name", "full_name", "desc", "categories"]
			});
		});
	}

	subscribe((v) => packages.push(...v));

	const updatePackageProp = (full_name: string, props: Partial<GUIPackage>) => {
		update((pkgs) => {
			const i = pkgs.findIndex((pkg) => pkg.full_name === full_name);
			if (i >= 0) {
				pkgs[i] = {
					...pkgs[i],
					...props
				};
			}
			return pkgs;
		});
	};

	const syncPackageData = async (guiPkg: Partial<GUIPackage>) => {
		if (guiPkg.synced) return;

		const pkg = await getPackage(guiPkg.full_name!); // ATM: pkg only bottles and github:string
		const readmeMd = `# ${guiPkg.full_name} #
To read more about this package go to [${guiPkg.homepage}](${guiPkg.homepage}).
		`;

		const updatedPackage: Partial<GUIPackage> = {
			...pkg,
			readme_md: readmeMd,
			synced: true
		};
		if (pkg.github) {
			const [owner, repo] = pkg.github.split("/");
			const [readme, contributors, repoData] = await Promise.all([
				getReadme(owner, repo),
				getContributors(owner, repo),
				getRepoAsPackage(owner, repo)
			]);
			if (readme) {
				updatedPackage.readme_md = readme;
			}
			updatedPackage.contributors = contributors;
			updatedPackage.license = repoData.license;
		}

		updatePackageProp(guiPkg.full_name!, updatedPackage);
	};

	const subscribeToPackage = (slug: string, cb: (pkg: GUIPackage) => void) => {
		subscribe((pkgs) => {
			const foundPackage = pkgs.find((p) => p.slug === slug) as GUIPackage;
			if (foundPackage) {
				cb(foundPackage);
				syncPackageData(foundPackage);
			}
		});
	};

	subscribeToPackage("tea_xyz", (teaPkg) => {
		teaPackage.set(teaPkg);
	});

	return {
		packages,
		teaPackage,
		subscribe,
		search: async (term: string, limit = 5): Promise<GUIPackage[]> => {
			if (!term || !packagesIndex) return [];
			// TODO: if online, use algolia else use Fuse
			const res = packagesIndex.search(term, { limit });
			const matchingPackages: GUIPackage[] = res.map((v) => v.item);
			return matchingPackages;
		},
		subscribeToPackage
	};
}
