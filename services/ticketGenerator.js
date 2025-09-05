const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

class TicketGeneratorService {
  constructor() {
    this.ticketsDir = path.join(__dirname, '../uploads/tickets');
    this.ensureTicketsDirectory();
  }

  ensureTicketsDirectory() {
    if (!fs.existsSync(this.ticketsDir)) {
      fs.mkdirSync(this.ticketsDir, { recursive: true });
    }
  }

  async generateQRCode(data) {
    try {
      return await QRCode.toDataURL(data, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        quality: 0.92,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
    } catch (error) {
      console.error('QR Code generation failed:', error);
      throw new Error('Failed to generate QR code');
    }
  }

  async generateTicketPDF(order, event) {
    try {
      const ticketId = `${order.orderNumber}-${Date.now()}`;
      const filename = `ticket-${ticketId}.pdf`;
      const filepath = path.join(this.ticketsDir, filename);

      // Create QR code data
      const qrData = JSON.stringify({
        orderId: order._id,
        orderNumber: order.orderNumber,
        eventId: event._id,
        customerEmail: order.customerInfo.email,
        ticketId: ticketId,
        verificationUrl: `${process.env.FRONTEND_URL}/verify-ticket/${ticketId}`
      });

      const qrCodeDataURL = await this.generateQRCode(qrData);
      const qrCodeBuffer = Buffer.from(qrCodeDataURL.split(',')[1], 'base64');

      // Create PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      // Pipe to file
      doc.pipe(fs.createWriteStream(filepath));

      // Header
      doc.fontSize(24)
         .fillColor('#FF6B35')
         .text('TICKETEER', 50, 50, { align: 'left' });

      doc.fontSize(16)
         .fillColor('#333333')
         .text('E-TICKET', 50, 80, { align: 'left' });

      // Event Information
      doc.fontSize(20)
         .fillColor('#000000')
         .text(event.name, 50, 130, { width: 400 });

      doc.fontSize(12)
         .fillColor('#666666')
         .text(`Date: ${new Date(event.startDate).toLocaleDateString('en-US', {
           weekday: 'long',
           year: 'numeric',
           month: 'long',
           day: 'numeric'
         })}`, 50, 170);

      doc.text(`Time: ${new Date(event.startDate).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })}`, 50, 185);

      doc.text(`Venue: ${event.venueName || event.location}`, 50, 200);

      if (event.description) {
        doc.text(`Description: ${event.description.substring(0, 200)}${event.description.length > 200 ? '...' : ''}`, 50, 215, { width: 400 });
      }

      // Ticket Details
      doc.fontSize(14)
         .fillColor('#000000')
         .text('TICKET DETAILS', 50, 270);

      let yPosition = 290;
      order.tickets.forEach((ticket, index) => {
        doc.fontSize(12)
           .fillColor('#333333')
           .text(`${ticket.name} x ${ticket.quantity}`, 50, yPosition);
        doc.text(`Rs${(ticket.price * ticket.quantity).toFixed(2)}`, 400, yPosition, { align: 'right' });
        yPosition += 20;
      });

      // Total
      doc.fontSize(14)
         .fillColor('#000000')
         .text(`Total: Rs${order.totalAmount.toFixed(2)}`, 400, yPosition + 10, { align: 'right' });

      // Customer Information
      doc.fontSize(14)
         .fillColor('#000000')
         .text('CUSTOMER INFORMATION', 50, yPosition + 50);

      doc.fontSize(12)
         .fillColor('#333333')
         .text(`Name: ${order.customerInfo.firstName} ${order.customerInfo.lastName}`, 50, yPosition + 70);
      doc.text(`Email: ${order.customerInfo.email}`, 50, yPosition + 85);
      if (order.customerInfo.phone) {
        doc.text(`Phone: ${order.customerInfo.phone}`, 50, yPosition + 100);
      }

      // Order Information
      doc.fontSize(14)
         .fillColor('#000000')
         .text('ORDER INFORMATION', 50, yPosition + 130);

      doc.fontSize(12)
         .fillColor('#333333')
         .text(`Order Number: ${order.orderNumber}`, 50, yPosition + 150);
      doc.text(`Ticket ID: ${ticketId}`, 50, yPosition + 165);
      doc.text(`Purchase Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, yPosition + 180);

      // QR Code
      doc.fontSize(14)
         .fillColor('#000000')
         .text('SCAN FOR VERIFICATION', 350, yPosition + 130);

      doc.image(qrCodeBuffer, 350, yPosition + 150, { width: 120, height: 120 });

      // Footer
      doc.fontSize(10)
         .fillColor('#999999')
         .text('Present this ticket at the venue entrance. Keep this ticket safe and do not share the QR code.', 50, 750, { 
           width: 500, 
           align: 'center' 
         });

      doc.text('For support, contact: support@ticketeer.com', 50, 770, { 
        width: 500, 
        align: 'center' 
      });

      // Finalize PDF
      doc.end();

      return {
        filename,
        filepath,
        ticketId
      };
    } catch (error) {
      console.error('Ticket PDF generation failed:', error);
      throw new Error('Failed to generate ticket PDF');
    }
  }

  async generateTicketsForOrder(order, event) {
    try {
      const tickets = [];
      
      // Generate one PDF for the entire order
      const ticketInfo = await this.generateTicketPDF(order, event);
      tickets.push(ticketInfo);

      return tickets;
    } catch (error) {
      console.error('Tickets generation failed:', error);
      throw new Error('Failed to generate tickets');
    }
  }

  getTicketPath(filename) {
    return path.join(this.ticketsDir, filename);
  }

  ticketExists(filename) {
    return fs.existsSync(this.getTicketPath(filename));
  }
}

module.exports = new TicketGeneratorService();
