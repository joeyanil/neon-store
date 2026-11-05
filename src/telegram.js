// Minimal Telegram Bot API client. The base URL is configurable so tests can point it at a fake server.

export class TelegramError extends Error {
  constructor(method, status, description) {
    super(`Telegram ${method} failed (${status}): ${description || 'no description'}`);
    this.method = method;
    this.status = status;
    this.description = description;
  }
}

/** Escape text for Telegram HTML parse mode. */
export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class Telegram {
  constructor(env, fetchImpl = (...args) => fetch(...args)) {  // wrapped: calling a bare `fetch` as a method throws "Illegal invocation" in Workers
    this.token = env.BOT_TOKEN;
    this.base = (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
    this.fetchImpl = fetchImpl;
  }

  async _send(method, init) {
    const res = await this.fetchImpl(`${this.base}/bot${this.token}/${method}`, { method: 'POST', ...init });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok || !data?.ok) throw new TelegramError(method, res.status, data?.description);
    return data.result;
  }

  call(method, payload) {
    return this._send(method, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }

  /** @param {Blob} photo */
  sendPhoto(chatId, photo, caption, extra = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', photo, 'receipt.jpg');
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (extra.reply_markup) form.append('reply_markup', JSON.stringify(extra.reply_markup));
    return this._send('sendPhoto', { body: form });
  }

  /** Sends a file silently. @param {Blob} blob */
  sendDocument(chatId, blob, filename, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', blob, filename);
    form.append('caption', caption);
    form.append('disable_notification', 'true');
    return this._send('sendDocument', { body: form });
  }

  editMessageReplyMarkup(chatId, messageId, replyMarkup) {
    return this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup });
  }

  editMessageText(chatId, messageId, text, replyMarkup) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup || { inline_keyboard: [] },
    });
  }

  editMessageCaption(chatId, messageId, caption, replyMarkup) {
    return this.call('editMessageCaption', {
      chat_id: chatId,
      message_id: messageId,
      caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup || { inline_keyboard: [] },
    });
  }

  deleteMessage(chatId, messageId) {
    return this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  /** Downloads a file the user sent (a photo). Returns a Blob, or null when it is too big or unavailable. */
  async downloadFile(fileId, maxBytes = 6 * 1024 * 1024) {
    const info = await this.call('getFile', { file_id: fileId });
    if (!info?.file_path || (info.file_size && info.file_size > maxBytes)) return null;
    const res = await this.fetchImpl(`${this.base}/file/bot${this.token}/${info.file_path}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size > maxBytes ? null : blob;
  }

  getWebhookInfo() {
    return this.call('getWebhookInfo', {});
  }

  getMe() {
    return this.call('getMe', {});
  }

  answerInlineQuery(id, results) {
    return this.call('answerInlineQuery', { inline_query_id: id, results, cache_time: 0, is_personal: true });
  }

  /** Edits a message that was sent through inline mode (it has no chat id, only an inline message id). */
  editInlineMessage(inlineMessageId, text, replyMarkup) {
    return this.call('editMessageText', {
      inline_message_id: inlineMessageId, text, parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }, reply_markup: replyMarkup,
    });
  }

  answerCallbackQuery(id, text, showAlert = false) {
    return this.call('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
  }
}
