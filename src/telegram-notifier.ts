export class TelegramNotifier {
  constructor(
    private readonly botToken: string,
    private readonly chatId: string,
    private readonly apiBaseUrl: string,
  ) {}

  async sendMessage(text: string): Promise<void> {
    const url = new URL(`/bot${this.botToken}/sendMessage`, this.apiBaseUrl);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
    }
  }
}
