const nodemailer = require("nodemailer");

// Create transporter object using Gmail SMTP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// HTML template for order status colors
const getStatusBadgeColor = (status) => {
  const colors = {
    pending: "#FFA500",
    processing: "#0088FF",
    shipped: "#00AA88",
    delivered: "#00CC00",
    cancelled: "#FF0000",
  };
  return colors[status.toLowerCase()] || "#808080";
};

// Function to generate item rows HTML
const generateItemRowsHtml = (items) => {
  if (!items || items.length === 0) return "";
  return items
    .map(
      (item) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
                ${item.product_name}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: center;">
                ${item.quantity}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
                ₹${item.product_price}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
                ₹${item.total_price}
            </td>
        </tr>
    `
    )
    .join("");
};

// Function to send order confirmation email
const sendOrderConfirmationEmail = async (orderDetails, recipientEmail) => {
  try {
    const statusColor = getStatusBadgeColor(orderDetails.status);

    const mailOptions = {
      from: `Olifera <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: `Order ${
        orderDetails.status === "pending" ? "Received" : "Updated"
      } @ Olifera.in #${orderDetails.orderId}`,
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Order ${orderDetails.status} - Olifera.in</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; margin: 0; padding: 0; background-color: #f1f1f1;">
                    <div style="max-width: 600px; margin: 20px auto; padding: 20px; background-color: white; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                        <div style="text-align: center; margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px;">
                            <img src="https://olifera.in/logo-footer.png" alt="Olifera Logo" style="max-width: 150px;">
                        </div>
                        
                        <div>
                            <h1 style="color: #333; margin-bottom: 20px; text-align: center; font-size: 24px;">
                                Order ${
                                  orderDetails.status === "pending"
                                    ? "Received"
                                    : "Updated"
                                }
                            </h1>
                            
                            <div style="background-color: white; border: 1px solid #ddd; border-radius: 5px; padding: 20px; margin-bottom: 20px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                    <span style="font-size: 16px; color: #666;">Order ID: <strong>#${
                                      orderDetails.orderId
                                    }</strong></span>
                                    
                                    <span style="color: ${statusColor}; padding: 5px 12px; border-radius: 15px; font-size: 14px; font-weight: bold;">
                                        ${orderDetails.status.toUpperCase()}
                                    </span>
                                </div>
                                
                                <div style="margin-bottom: 20px; border-top: 1px solid #eee; padding-top: 20px;">
                                    <h3 style="color: #333; margin-top: 0; margin-bottom: 15px;">Customer Details</h3>
                                    <p style="margin: 5px 0; color: #555;"><strong>Name:</strong> ${
                                      orderDetails.customerName
                                    }</p>
                                    <p style="margin: 5px 0; color: #555;"><strong>Email:</strong> ${
                                      orderDetails.customerEmail
                                    }</p>
                                    <p style="margin: 5px 0; color: #555;"><strong>Shipping Address:</strong> ${
                                      orderDetails.shippingAddress
                                    }</p>
                                </div>

                                <div style="overflow-x: auto;">
                                    <table style="width: 100%; border-collapse: collapse;">
                                        <thead>
                                            <tr style="background-color: #f8f9fa;">
                                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #ddd;">Item</th>
                                                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #ddd;">Qty</th>
                                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Price</th>
                                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #ddd;">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${generateItemRowsHtml(
                                              orderDetails.items
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div style="border-top: 2px solid #ddd; padding-top: 15px; margin-top: 20px; text-align: right;">
                                    <p style="margin: 5px 0; color: #333;">
                                        <strong>Total Amount:</strong> 
                                        <span style="font-size: 20px; color: #000; font-weight: bold;">₹${
                                          orderDetails.totalAmount
                                        }</span>
                                    </p>
                                    <p style="margin: 5px 0; color: #888; font-size: 14px;">
                                        Order Date: ${new Date().toLocaleDateString("en-GB")}
                                    </p>
                                </div>
                            </div>

                            <div style="text-align: center; margin-top: 30px; color: #666; font-size: 14px;">
                                <p>Thank you for choosing Olifera!</p>
                                <p>If you have any questions, please contact us at <a href="mailto:info@olifera.in" style="color: #007bff;">info@olifera.in</a></p>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};

module.exports = {
  sendOrderConfirmationEmail,
};
