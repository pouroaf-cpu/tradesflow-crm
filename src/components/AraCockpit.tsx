"use client";

export type CallerIntel = {
  rowNumber: number;
  name: string;
  tradeType: string;
  phone: string;
  region: string;
  invoiceAmount?: string;
  daysOverdue?: number;
  attempts: number;
  lastCall: string;
};

export type ClaudeFeedMessage = {
  id: number;
  time: string;
  text: string;
};

export type TranscriptLine = {
  id: number;
  time: string;
  label: string;
  text: string;
};

export type Objection = { text: string; response: string } | null;
