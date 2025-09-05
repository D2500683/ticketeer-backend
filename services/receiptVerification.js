const Tesseract = require('tesseract.js');
const sharp = require('sharp');

class ReceiptVerificationService {
  constructor() {
    this.worker = null;
  }

  async initializeWorker() {
    if (!this.worker) {
      this.worker = await Tesseract.createWorker();
      await this.worker.loadLanguage('eng');
      await this.worker.initialize('eng');
    }
    return this.worker;
  }

  async preprocessImage(imagePath) {
    try {
      // Enhance image for better OCR results
      const processedImagePath = imagePath.replace(/\.(jpg|jpeg|png)$/i, '_processed.png');
      
      await sharp(imagePath)
        .greyscale()
        .normalize()
        .sharpen()
        .png()
        .toFile(processedImagePath);
      
      return processedImagePath;
    } catch (error) {
      console.error('Image preprocessing failed:', error);
      return imagePath; // Return original if preprocessing fails
    }
  }

  async extractTextFromReceipt(imagePath) {
    try {
      const worker = await this.initializeWorker();
      const processedImagePath = await this.preprocessImage(imagePath);
      
      const { data: { text } } = await worker.recognize(processedImagePath);
      
      return text;
    } catch (error) {
      console.error('OCR extraction failed:', error);
      throw new Error('Failed to extract text from receipt');
    }
  }

  parseReceiptData(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const receiptData = {
      amount: null,
      reference: null,
      transactionId: null,
      date: null,
      time: null,
      recipient: null,
      rawText: text
    };

    for (const line of lines) {
      // Extract amount (look for patterns like Rs 150.00, MUR 150, etc.)
      const amountMatch = line.match(/(?:Rs|MUR|₨)\s*(\d+(?:\.\d{2})?)/i);
      if (amountMatch && !receiptData.amount) {
        receiptData.amount = parseFloat(amountMatch[1]);
      }

      // Extract reference code (look for patterns like TCK123456)
      const referenceMatch = line.match(/(?:ref|reference|note|description).*?(TCK\w+)/i);
      if (referenceMatch) {
        receiptData.reference = referenceMatch[1];
      }

      // Extract transaction ID
      const transactionMatch = line.match(/(?:transaction|trans|id).*?(\w{8,})/i);
      if (transactionMatch && !receiptData.transactionId) {
        receiptData.transactionId = transactionMatch[1];
      }

      // Extract date
      const dateMatch = line.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
      if (dateMatch && !receiptData.date) {
        receiptData.date = dateMatch[1];
      }

      // Extract time
      const timeMatch = line.match(/(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)/i);
      if (timeMatch && !receiptData.time) {
        receiptData.time = timeMatch[1];
      }

      // Extract recipient (MCB Juice number)
      const recipientMatch = line.match(/(?:to|recipient).*?(\+?\d{3}\s?\d{4}\s?\d{4})/i);
      if (recipientMatch && !receiptData.recipient) {
        receiptData.recipient = recipientMatch[1];
      }
    }

    return receiptData;
  }

  async verifyReceipt(imagePath, expectedAmount, expectedReference, expectedRecipient = null) {
    try {
      const extractedText = await this.extractTextFromReceipt(imagePath);
      const receiptData = this.parseReceiptData(extractedText);

      const verification = {
        isValid: false,
        confidence: 0,
        extractedData: receiptData,
        checks: {
          amountMatch: false,
          referenceMatch: false,
          recipientMatch: true, // Default to true if not checking recipient
          hasTransactionId: false
        },
        issues: []
      };

      // Check amount
      if (receiptData.amount) {
        const amountDifference = Math.abs(receiptData.amount - expectedAmount);
        verification.checks.amountMatch = amountDifference <= 0.01; // Allow 1 cent difference
        if (!verification.checks.amountMatch) {
          verification.issues.push(`Amount mismatch: expected ${expectedAmount}, found ${receiptData.amount}`);
        }
      } else {
        verification.issues.push('Amount not found in receipt');
      }

      // Check reference code
      if (receiptData.reference) {
        verification.checks.referenceMatch = receiptData.reference === expectedReference;
        if (!verification.checks.referenceMatch) {
          verification.issues.push(`Reference mismatch: expected ${expectedReference}, found ${receiptData.reference}`);
        }
      } else {
        verification.issues.push('Reference code not found in receipt');
      }

      // Check recipient (if provided)
      if (expectedRecipient && receiptData.recipient) {
        const normalizedExpected = expectedRecipient.replace(/\s/g, '');
        const normalizedFound = receiptData.recipient.replace(/\s/g, '');
        verification.checks.recipientMatch = normalizedFound.includes(normalizedExpected) || 
                                           normalizedExpected.includes(normalizedFound);
        if (!verification.checks.recipientMatch) {
          verification.issues.push(`Recipient mismatch: expected ${expectedRecipient}, found ${receiptData.recipient}`);
        }
      }

      // Check for transaction ID
      verification.checks.hasTransactionId = !!receiptData.transactionId;

      // Calculate confidence score
      let score = 0;
      if (verification.checks.amountMatch) score += 40;
      if (verification.checks.referenceMatch) score += 40;
      if (verification.checks.recipientMatch) score += 10;
      if (verification.checks.hasTransactionId) score += 10;

      verification.confidence = score;
      verification.isValid = score >= 40; // Lowered threshold for automatic approval

      return verification;
    } catch (error) {
      console.error('Receipt verification failed:', error);
      return {
        isValid: false,
        confidence: 0,
        error: error.message,
        extractedData: null,
        checks: {
          amountMatch: false,
          referenceMatch: false,
          recipientMatch: false,
          hasTransactionId: false
        },
        issues: ['Failed to process receipt image']
      };
    }
  }

  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

module.exports = new ReceiptVerificationService();
