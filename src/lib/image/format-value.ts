/** Turns an ExifTool JSON value into short, control-character-free plain text. */
export function formatValue(value: unknown, maxLength = 200): string {
  let text: string;
  if (typeof value === "string") text = value.startsWith("base64:") ? "(binary data)" : value;
  else if (Array.isArray(value)) text = value.map((v) => formatValue(v, maxLength)).join(", ");
  else if (value !== null && typeof value === "object") text = "(structured data)";
  else text = String(value);
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
