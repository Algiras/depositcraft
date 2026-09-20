import { defineConfig } from '@playwright/test';
import { createPlaywrightBaseConfig } from '@wix-extensions/core/playwright';

export default defineConfig(createPlaywrightBaseConfig({ port: 4174 }));
