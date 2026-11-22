/* eslint-disable prettier/prettier */
import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * The verified identifier from a verifyAccessToken reply, in any of the shapes
 * MSG91 has been seen to use. `message` only counts on a success reply, so an
 * error message is never mistaken for an identifier.
 */
function pickIdentifier(data: any): string | null {
  if (typeof data === 'string') return nonEmptyString(data);
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'success') {
    const fromSuccess =
      nonEmptyString(data.data?.mobile) ??
      nonEmptyString(data.data?.email) ??
      nonEmptyString(data.data?.identifier) ??
      nonEmptyString(data.message);
    if (fromSuccess) return fromSuccess;
  }
  return nonEmptyString(data.mobile) ?? nonEmptyString(data.email);
}

@Injectable()
export class Msg91Service {
  private readonly logger = new Logger(Msg91Service.name);
  private readonly msg91ApiUrl =
    'https://control.msg91.com/api/v5/widget/verifyAccessToken';
  private readonly authKey: string;

  constructor(private configService: ConfigService) {
    this.authKey = this.configService.get<string>('MSG91_AUTH_KEY');
    if (!this.authKey) {
      this.logger.error('MSG91_AUTH_KEY is not configured');
      throw new Error('MSG91_AUTH_KEY is required');
    }
  }

  /**
   * Verify the access token received from MSG91 OTP widget
   * @param accessToken - JWT token received from MSG91 widget after OTP verification
   * @returns Promise<string> - Returns the verified phone number
   * @throws HttpException - Throws exception if token verification fails
   */
  async verifyAccessToken(accessToken: string): Promise<string> {
    try {
      const phoneNumber = (await this.fetchVerifiedIdentifier(accessToken))
        .trim();

      // An email-OTP token must never be read as a phone number (it would
      // otherwise become "+you@example.com").
      if (!phoneNumber || phoneNumber.length < 10 || phoneNumber.includes('@')) {
        this.logger.warn(
          'Invalid phone number received from MSG91:',
          phoneNumber,
        );
        throw new HttpException(
          'Invalid phone number received',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // Ensure phone number starts with + for consistency
      const formattedPhone = phoneNumber.startsWith('+')
        ? phoneNumber
        : `+${phoneNumber}`;

      this.logger.log(
        `Access token verified successfully for phone: ${formattedPhone}`,
      );
      return formattedPhone;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        'Unexpected error during MSG91 token verification:',
        error.message,
      );
      throw new HttpException(
        'Failed to verify access token',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Verify an access token from an EMAIL OTP and return the verified address,
   * trimmed and lowercased. The address comes from MSG91, never the client.
   * @throws HttpException 401 when the token is invalid or did not verify an email
   */
  async verifyEmailAccessToken(accessToken: string): Promise<string> {
    try {
      const email = (await this.fetchVerifiedIdentifier(accessToken))
        .trim()
        .toLowerCase();

      if (!EMAIL_PATTERN.test(email)) {
        this.logger.warn('MSG91 token did not verify an email address');
        throw new HttpException(
          'Invalid or expired access token',
          HttpStatus.UNAUTHORIZED,
        );
      }

      this.logger.log('Access token verified successfully for an email');
      return email;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        'Unexpected error during MSG91 email token verification:',
        error.message,
      );
      throw new HttpException(
        'Failed to verify access token',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Call MSG91 verifyAccessToken and return the verified identifier (a phone
   * number or an email address) exactly as MSG91 reports it.
   */
  private async fetchVerifiedIdentifier(accessToken: string): Promise<string> {
    this.logger.log('Verifying access token with MSG91...');

    const response = await fetch(this.msg91ApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        authkey: this.authKey,
        'access-token': accessToken,
      }),
    });

    if (!response.ok) {
      this.logger.error(
        `MSG91 API request failed with status: ${response.status}`,
      );
      throw new HttpException(
        'Failed to verify access token with MSG91',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const responseText = await response.text();
    this.logger.log(`MSG91 API raw response: ${responseText}`);

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      // Not JSON: MSG91 replied with the identifier itself.
      data = responseText;
    }

    const identifier = pickIdentifier(data);
    if (!identifier) {
      this.logger.warn(
        'MSG91 token verification failed - invalid response format:',
        responseText,
      );
      throw new HttpException(
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return identifier;
  }

  /**
   * Format phone number to ensure consistency
   * @param phone - Phone number to format
   * @returns Formatted phone number with country code
   */
  private formatPhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[^\d+]/g, '');

    // Ensure it starts with + if it doesn't already
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }
}
