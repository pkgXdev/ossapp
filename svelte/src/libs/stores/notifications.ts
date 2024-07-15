import { writable } from "svelte/store";
import { nanoid } from "nanoid";
import { NotificationType } from "$libs/types";
import type { Notification } from "$libs/types";
import { listenToChannel, relaunch } from "@native";

export default function initNotificationStore() {
  const { update, subscribe } = writable<Notification[]>([]);
  const restartAlert = writable(false);

  const remove = (id: string) => {
    update((notifications) => notifications.filter((n) => n.id !== id));
  };

  const add = (partialNotification: Partial<Notification>) => {
    if (!partialNotification.message) {
      throw new Error("Message is required for notification");
    }

    const notification: Notification = {
      id: nanoid(6), // Increased from 4 to 6 for more uniqueness
      i18n_key: partialNotification.i18n_key || "",
      type: partialNotification.type || NotificationType.MESSAGE,
      message: partialNotification.message,
      ...partialNotification
    };

    update((values) => [notification, ...values]);
  };

  listenToChannel("message", (data: { message: string; params: { [key: string]: string } }) => {
    const { message, params } = data;
    
    add({
      message,
      i18n_key: params.i18n_key || "",
      type: NotificationType.ACTION_BANNER,
      params,
      callback_label: params.action ? params.action.toUpperCase() : undefined,
      callback: params.action ? () => {
        relaunch();
        remove(nanoid(6)); // This might need adjustment
      } : undefined
    });
  });

  return {
    subscribe,
    remove,
    add,
    restartAlert
  };
}
