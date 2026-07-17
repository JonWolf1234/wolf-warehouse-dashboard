import nodemailer from "nodemailer";

export function createCertificateTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure:
      String(
        process.env.SMTP_SECURE || "false"
      ).toLowerCase() === "true",

    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

export async function sendCertificateEmail({
  recipient,
  subject,
  text,
  attachments
}) {
  const transport =
    createCertificateTransport();

  return transport.sendMail({
    from: {
      name:
        process.env.SMTP_FROM_NAME ||
        "Wolf Event Services",

      address:
        process.env.SMTP_FROM_EMAIL
    },

    replyTo:
      process.env.SMTP_REPLY_TO,

    to: recipient,

    subject,

    text,

    attachments
  });
}