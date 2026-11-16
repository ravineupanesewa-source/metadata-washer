/**
 * Optional "support the project" modal, shown after a download. Edit the values below.
 *
 *   qrImage   Your eSewa QR code. Put the image file in `public/support/` and set its path here
 *             (e.g. "/support/esewa-qr.png"). If the file is missing, the QR part is left out
 *             instead of showing a broken image (the card still shows the eSewa ID, if set).
 *   esewaId   Optional: the eSewa ID (usually the registered mobile number) shown with a copy
 *             button, so people on phones can pay without scanning. Leave "" to hide it.
 *             To turn the card off entirely, leave both qrImage and esewaId empty.
 *   name      Optional: the account holder's name shown under the QR, so people can confirm
 *             they are paying the right person in the eSewa app. Leave "" to hide it.
 */
export const SUPPORT = {
  qrImage: "/support/esewa-qr.png",
  esewaId: "9862580879",
  name: "",
} as const;

/** After "Maybe later" (or closing it), the modal stays away on this device for this long. */
export const SUPPORT_SNOOZE_DAYS = 14;
/** After "I've sent it", it stays away for longer. */
export const SUPPORT_PAID_SNOOZE_DAYS = 60;

/** Suggested tips. A personal eSewa QR can't carry an amount, so these are shown as guidance. */
export const SUPPORT_AMOUNTS = [
  { amount: 50, label: "Chiya" },
  { amount: 150, label: "Momo plate" },
  { amount: 500, label: "Big thanks" },
] as const;
/** Index of the amount selected when the modal opens. */
export const SUPPORT_DEFAULT_AMOUNT = 1;

/**
 * Master switch for the post-download eSewa support modal. Temporarily off: flip back to
 * `true` to bring it back (all the code and config above is kept as-is).
 */
export const SUPPORT_MODAL_ENABLED = false;

/** The card shows if it's switched on and there's any way to pay: a QR image, an eSewa ID, or both. */
export const supportEnabled =
  SUPPORT_MODAL_ENABLED && (SUPPORT.qrImage.trim().length > 0 || SUPPORT.esewaId.trim().length > 0);
