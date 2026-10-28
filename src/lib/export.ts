import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { UserData } from "../types";

export async function exportUserData(data: UserData, day: string) {
  const json = JSON.stringify(data, null, 2);
  const filename = `Xiaoma Piano practice records-${day}.json`;
  if (Capacitor.isNativePlatform()) {
    const saved = await Filesystem.writeFile({
      path: filename,
      data: json,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: "Xiaoma Piano practice records",
      files: [saved.uri],
      dialogTitle: "Save or share practice records",
    });
    return;
  }
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
