import nodemailer from "nodemailer";

function requiredEmailConfig() {
  const host =
    process.env.SMTP_HOST?.trim();

  const port =
    Number(
      process.env.SMTP_PORT || 587
    );

  const secure =
    String(
      process.env.SMTP_SECURE || "false"
    ).toLowerCase() === "true";

  const user =
    process.env.SMTP_USER?.trim();

  const password =
    process.env.SMTP_PASSWORD;

  const fromEmail =
    process.env.SMTP_FROM_EMAIL?.trim();

  const fromName =
    process.env.SMTP_FROM_NAME?.trim() ||
    "Wolf Event Services";

  const replyTo =
    process.env.SMTP_REPLY_TO?.trim();

  if (
    !host ||
    !user ||
    !password ||
    !fromEmail
  ) {
    const error = new Error(
      "Certificate email delivery is not fully configured."
    );

    error.status = 503;
    throw error;
  }

  return {
    host,
    port,
    secure,
    user,
    password,
    fromEmail,
    fromName,
    replyTo
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function certificateRows(certificates) {
  if (!certificates.length) {
    return `
      <tr>
        <td
          style="
            padding: 14px 16px;
            border-top: 1px solid #e6e9e7;
            color: #69716d;
            font-size: 14px;
          "
        >
          No certificate details were supplied.
        </td>
      </tr>
    `;
  }

  return certificates
    .map(
      (certificate) => `
        <tr>
          <td
            style="
              padding: 13px 16px;
              border-top: 1px solid #e6e9e7;
              vertical-align: middle;
            "
          >
            <table
              role="presentation"
              width="100%"
              cellspacing="0"
              cellpadding="0"
              border="0"
            >
              <tr>
                <td
                  style="
                    color: #132019;
                    font-size: 14px;
                    font-weight: 700;
                  "
                >
                  ${escapeHtml(
                    certificate.assetNumber
                  )}
                </td>

                <td
                  align="right"
                  style="
                    color: #69716d;
                    font-size: 13px;
                  "
                >
                  ${escapeHtml(
                    certificate.filename
                  )}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
    )
    .join("");
}

function missingCertificateBlock(
  missing
) {
  if (!missing.length) {
    return "";
  }

  return `
    <tr>
      <td style="padding: 0 34px 24px;">
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="
            border: 1px solid #e8b98f;
            border-radius: 10px;
            background: #fff7f0;
          "
        >
          <tr>
            <td style="padding: 15px 17px;">
              <div
                style="
                  margin-bottom: 6px;
                  color: #a44f13;
                  font-size: 12px;
                  font-weight: 800;
                  letter-spacing: 0.08em;
                  text-transform: uppercase;
                "
              >
                Certificates not located
              </div>

              <div
                style="
                  color: #5f3720;
                  font-size: 14px;
                  line-height: 1.55;
                "
              >
                ${escapeHtml(
                  missing.join(", ")
                )}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function buildCertificateEmailHtml({
  jobReference,
  certificates,
  missing,
  fromName
}) {
  const reference =
    escapeHtml(
      jobReference ||
      "Equipment hire"
    );

  const attachmentCount =
    certificates.length;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1"
        />

        <title>
          Motor certificates - ${reference}
        </title>
      </head>

      <body
        style="
          margin: 0;
          padding: 0;
          background: #eef1ef;
          font-family:
            Helvetica,
            Arial,
            sans-serif;
          color: #132019;
        "
      >
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="background: #eef1ef;"
        >
          <tr>
            <td
              align="center"
              style="padding: 34px 16px;"
            >
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  width: 100%;
                  max-width: 640px;
                  overflow: hidden;
                  border: 1px solid #dfe4e1;
                  border-radius: 16px;
                  background: #ffffff;
                  box-shadow:
                    0 12px 35px
                    rgba(18, 32, 25, 0.08);
                "
              >
                <tr>
                  <td
                    style="
                      padding: 26px 34px 22px;
                      background: #12271c;
                    "
                  >
                    <div
                      style="
                        color: #ffffff;
                        font-size: 29px;
                        line-height: 1;
                        letter-spacing: -0.04em;
                      "
                    >
                      <span
                        style="
                          font-weight: 800;
                        "
                      >
                        WOLF
                      </span>

                      <span
                        style="
                          font-weight: 300;
                        "
                      >
                        Lighting
                      </span>
                    </div>

                    <div
                      style="
                        width: 72px;
                        height: 4px;
                        margin-top: 13px;
                        border-radius: 4px;
                        background: #ef7b32;
                      "
                    ></div>
                  </td>
                </tr>

                <tr>
                  <td
                    style="
                      padding: 34px 34px 18px;
                    "
                  >
                    <div
                      style="
                        margin-bottom: 8px;
                        color: #14763c;
                        font-size: 12px;
                        font-weight: 800;
                        letter-spacing: 0.1em;
                        text-transform: uppercase;
                      "
                    >
                      Equipment documentation
                    </div>

                    <h1
                      style="
                        margin: 0 0 16px;
                        color: #132019;
                        font-size: 27px;
                        line-height: 1.2;
                        letter-spacing: -0.03em;
                      "
                    >
                      Motor certificates
                    </h1>

                    <p
                      style="
                        margin: 0 0 11px;
                        color: #3d4842;
                        font-size: 15px;
                        line-height: 1.65;
                      "
                    >
                      Hi,
                    </p>

                    <p
                      style="
                        margin: 0;
                        color: #3d4842;
                        font-size: 15px;
                        line-height: 1.65;
                      "
                    >
                      Please find attached the motor
                      certificates for
                      <strong>${reference}</strong>.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 12px 34px 24px;">
                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        border: 1px solid #dfe4e1;
                        border-radius: 12px;
                        background: #f8faf9;
                      "
                    >
                      <tr>
                        <td
                          style="
                            padding: 16px;
                          "
                        >
                          <table
                            role="presentation"
                            width="100%"
                            cellspacing="0"
                            cellpadding="0"
                            border="0"
                          >
                            <tr>
                              <td>
                                <div
                                  style="
                                    color: #69716d;
                                    font-size: 11px;
                                    font-weight: 800;
                                    letter-spacing: 0.08em;
                                    text-transform: uppercase;
                                  "
                                >
                                  Job reference
                                </div>

                                <div
                                  style="
                                    margin-top: 5px;
                                    color: #132019;
                                    font-size: 18px;
                                    font-weight: 800;
                                  "
                                >
                                  ${reference}
                                </div>
                              </td>

                              <td align="right">
                                <div
                                  style="
                                    color: #69716d;
                                    font-size: 11px;
                                    font-weight: 800;
                                    letter-spacing: 0.08em;
                                    text-transform: uppercase;
                                  "
                                >
                                  Attachments
                                </div>

                                <div
                                  style="
                                    margin-top: 5px;
                                    color: #14763c;
                                    font-size: 18px;
                                    font-weight: 800;
                                  "
                                >
                                  ${attachmentCount}
                                </div>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 0 34px 24px;">
                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        overflow: hidden;
                        border: 1px solid #dfe4e1;
                        border-radius: 12px;
                        background: #ffffff;
                      "
                    >
                      <tr>
                        <td
                          style="
                            padding: 13px 16px;
                            background: #f3f6f4;
                            color: #3d4842;
                            font-size: 12px;
                            font-weight: 800;
                            letter-spacing: 0.08em;
                            text-transform: uppercase;
                          "
                        >
                          Attached certificates
                        </td>
                      </tr>

                      ${certificateRows(
                        certificates
                      )}
                    </table>
                  </td>
                </tr>

                ${missingCertificateBlock(
                  missing
                )}

                <tr>
                  <td
                    style="
                      padding: 0 34px 34px;
                    "
                  >
                    <p
                      style="
                        margin: 0 0 22px;
                        color: #3d4842;
                        font-size: 15px;
                        line-height: 1.65;
                      "
                    >
                      Please reply to this email if
                      you require any further
                      information.
                    </p>

                    <p
                      style="
                        margin: 0;
                        color: #132019;
                        font-size: 15px;
                        line-height: 1.55;
                      "
                    >
                      Kind regards,<br />

                      <strong>
                        ${escapeHtml(
                          fromName
                        )}
                      </strong>
                    </p>
                  </td>
                </tr>

                <tr>
                  <td
                    style="
                      padding: 18px 34px;
                      border-top: 1px solid #dfe4e1;
                      background: #f8faf9;
                      color: #7a837e;
                      font-size: 11px;
                      line-height: 1.6;
                    "
                  >
                    This email was generated by the
                    Wolf warehouse documentation
                    system.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export function createCertificateTransport() {
  const config =
    requiredEmailConfig();

  return nodemailer.createTransport({
    host:
      config.host,

    port:
      config.port,

    secure:
      config.secure,

    auth: {
      user:
        config.user,

      pass:
        config.password
    },

    connectionTimeout:
      30_000,

    greetingTimeout:
      30_000,

    socketTimeout:
      60_000
  });
}

export async function sendCertificateEmail({
  recipient,
  subject,
  text,
  attachments,
  jobReference,
  certificates = [],
  missing = []
}) {
  const config =
    requiredEmailConfig();

  const transport =
    createCertificateTransport();

  return transport.sendMail({
    from: {
      name:
        config.fromName,

      address:
        config.fromEmail
    },

    replyTo:
      config.replyTo ||
      undefined,

    to:
      recipient,

    subject,

    text,

    html:
      buildCertificateEmailHtml({
        jobReference,
        certificates,
        missing,
        fromName:
          config.fromName
      }),

    attachments
  });
}