export type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat: {
      id: number | string;
    };
  };
};

type TelegramApiResponse<TResult> = {
  ok: boolean;
  result?: TResult;
  description?: string;
};

export class TelegramNotifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly apiBaseUrl: string,
  ) {}

  async sendMessage(text: string): Promise<void> {
    await this.sendMessageToChat(this.chatId, text);
  }

  async sendMessageToChat(chatId: string, text: string): Promise<void> {
    const url = new URL(`/bot${this.botToken}/sendMessage`, this.apiBaseUrl);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
    }
  }

  async getUpdates(offset?: number): Promise<TelegramUpdate[]> {
    const url = new URL(`/bot${this.botToken}/getUpdates`, this.apiBaseUrl);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        offset,
        timeout: 0,
        allowed_updates: ["message"],
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram getUpdates failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as TelegramApiResponse<TelegramUpdate[]>;

    if (!body.ok || body.result === undefined) {
      throw new Error(`Telegram getUpdates failed: ${body.description ?? "unknown error"}`);
    }

    return body.result;
  }
}
