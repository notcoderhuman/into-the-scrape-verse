# ScrapeShield

> Self-healing web intelligence

ScrapeShield is a web-data reliability dashboard built around a custom Bright Data Scraper Studio collector.

## Problem

Websites change frequently.

A scraper that works today can later return incomplete or incorrect data when the target page structure changes.

ScrapeShield detects missing or invalid extracted data and makes scraper health and recovery visible.

## Solution

ScrapeShield adds a reliability layer around a custom Bright Data Scraper Studio collector.

The application:

1. Runs the existing Bright Data collector.
2. Receives structured product data.
3. Validates required fields.
4. Calculates scraper health.
5. Identifies missing or invalid fields.
6. Records observed recovery events.
7. Verifies the result after a Bright Data Self-Healing repair.

> ScrapeShield monitors and verifies. Bright Data performs the scraper self-healing.

## Architecture

```text
Target Website
      |
      v
Bright Data Scraper Studio
      |
      v
Structured JSON
      |
      v
ScrapeShield server.js
      |
      +---- Field validation
      |
      +---- Recovery history
      |
      v
/api/dashboard
      |
      v
Browser Dashboard
