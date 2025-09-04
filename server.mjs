// server.mjs — Formula Guru 2 (final w/ Pravana Express Tones guard + 1N black fix)
// Category-aware (Permanent / Demi / Semi) with manufacturer mixing rules
// Enforces ratios + developer names, validates shade formats, and adds
// analysis-aware guard for Pravana ChromaSilk Express Tones suitability.
// Also normalizes level-1/2 black to 1N (not 1A) on supported DEMI lines.
// ------------------------------------------------------------------

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import { OpenAI } from 'openai';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
const upload = multer({ dest: process.env.UPLOAD_DIR || 'tmp/' });

// ---------------------------- OpenAI Setup ----------------------------
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// ----------------------------- Brand Catalogs ------------------------------
const DEMI_BRANDS = [
  'Redken Shades EQ',
  'Wella Color Touch',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
  'Schwarzkopf Igora Vibrance',
  'Pravana ChromaSilk Express Tones',
];

const PERMANENT_BRANDS = [
  'Redken Color Gels Lacquers',
  'Wella Koleston Perfect',
  'Wella Illumina Color',
  'L’Oréal Professionnel Majirel',
  'Matrix SoColor Permanent',
  'Goldwell Topchic',
  'Schwarzkopf Igora Royal',
  'Pravana ChromaSilk Permanent Crème Color',
];

const SEMI_BRANDS = [
  'Wella Color Fresh',
  'Goldwell Elumen',
  'Pravana ChromaSilk Vivids',
  'Schwarzkopf Chroma ID',
  'Matrix SoColor Cult',
];

// ------------------------- Brand Allow-Lists ------------------------------
//
// The following allow-lists enumerate all shade codes or names that are
// considered legitimate for each supported brand. These lists were
// assembled from manufacturer shade charts and common salon references. A
// hard validator will use these lists to ensure that every formula
// returned by the model references only real, on-label shades for the
// selected brand. Cross‑brand or invented codes will cause a retry or
// safe failure. For Goldwell Colorance both the core 2:1 line and the
// Gloss Tones 1:1 shades are allowed.

const BRAND_ALLOWLISTS = {
  // DEMI (deposit only)
  'Redken Shades EQ': new Set([
    // Level 10 (010 series)
    '010T','010NA','010P','010N','010AG','010NB','010VG','010NW','010GI','010G','010WG','010VV',
    // Level 9 (09 series)
    '09T','09B','09NA','09P','09M','09N','09AG','09NB','09VG','09NW','09GI','09GB','09G','09AA','09RB','09VRo','09V',
    // Level 8 (08 series)
    '08T','08GN','08VB','08NA','08N','08VG','08GI','08GG','08WG','08C','08CR','08VRo','08V',
    // Level 7 (07 series)
    '07T','07VB','07NA','07P','07M','07NCH','07N','07AG','07NB','07NW','07GB','07G','07C','07CB','07CC','07RR','07VRo','07V','07RO','07RB','07GN',
    // Level 6 (06 series)
    '06T','06NA','06NB','06N','06NN','06G','06GB','06GI','06AG','06AA','06BV','06VRo','06V','06RV','06RR',
    // Level 5 (05 series)
    '05T','05N','05NB','05NN','05G','05GB','05GI','05AG','05AA','05AB','05RB','05RR','05VR','05CC',
    // Level 4 (04 series)
    '04T','04N','04NB','04NN','04G','04GB','04GI','04AG','04AA','04ABN','04RB','04RR','04VR','04CC','04VRo','04RO','04ABn',
    // Level 3 (03 series)
    '03N','03NB','03NN','03G','03GB','03GI','03AG','03AA','03AB','03RV','03RR','03VR','03CC',
    // Level 2 (02 series)
    '02N','02NN','02G','02GB','02GI','02AG','02AA','02RB','02RV','02RR','02VR',
    // Level 1 (01 series)
    '01N','01B','01T','01P','01A','01V','01NB','01VV','01AA'
  ]),

  'Wella Color Touch': new Set([
    // Special Mix and Clear
    '0/00','0/34','0/43','0/45','0/56','0/68','0/88',
    // Level 10
    '10/0','10/01','10/03','10/04','10/6','10/8','10/81','10/73','10/95','10/96',
    // Level 9
    '9/0','9/01','9/03','9/16','9/36','9/73','9/95','9/96','9/34','9/37','9/55','9/4','9/43',
    // Level 8
    '8/0','8/03','8/1','8/81','8/71','8/74','8/68','8/43','8/44','8/77','8/74',
    // Level 7
    '7/0','7/03','7/1','7/17','7/3','7/34','7/36','7/4','7/47','7/57','7/7','7/75','7/77','7/86','7/89','7/07','7/73','7/43',
    // Level 6
    '6/0','6/03','6/07','6/1','6/3','6/7','6/4','6/43','6/75','6/74','6/77','6/71','6/43',
    // Level 5
    '5/0','5/1','5/3','5/4','5/07','5/75','5/5','5/86','5/89',
    // Level 4
    '4/0','4/07','4/3','4/4','4/57','4/77',
    // Level 3
    '3/0','3/3','3/6','3/07','3/68','3/45','3/66',
    // Level 2
    '2/0','2/1','2/3','2/4','2/6',
    // Level 1
    '1/0','1/1','1/2','1/4','1/6'
  ]),

  'Paul Mitchell The Demi': new Set([
    '1N','1NB','1A','1VR','1RV','1RB',
    '2N','2NB','2A','2VR','2RV','2RB','2G',
    '3N','3NB','3A','3VR','3RV','3RB','3G','3BV','3OR',
    '4N','4NB','4A','4VR','4RV','4RB','4G','4WB','4R',
    '5N','5NB','5A','5VR','5RV','5RB','5G','5WB','5R','5GB','5CC','5PV',
    '6N','6NB','6A','6VR','6RV','6RB','6G','6WB','6R','6GB','6MV','6MT','6PV','6P','6W',
    '7N','7NB','7A','7VR','7RV','7RB','7G','7WB','7R','7GB','7CC','7PV','7P','7W','7VA',
    '8N','8NB','8A','8VR','8RV','8RB','8G','8WB','8R','8GV','8GB','8M','8PV','8P','8W',
    '9N','9NB','9A','9VR','9RV','9RB','9G','9WB','9R','9GB','9GV','9PV','9P','9W','9BV',
    '10N','10NC','10GV','10G','10GB','10V'
  ]),

  'Matrix SoColor Sync': new Set([
    '1N','2N','3N','4N','5N','6N','7N','8N','9N','10N',
    '2A','3A','4A','5A','6A','7A','8A','9A','10A',
    '3M','4M','5M','6M','7M','8M','9M','10M',
    '3R','4R','5R','6R','7R','8R','9R','10R',
    '5RC','6RC','7RC','8RC','9RC','10RC',
    '5RV','6RV','7RV','8RV','9RV','10RV',
    '5P','6P','7P','8P','9P','10P',
    '4G','5G','6G','7G','8G','9G','10G',
    '5BV','6BV','7BV','8BV','9BV','10BV',
    '5CG','6CG','7CG','8CG','9CG',
    '6RB','7RB','8RB',
    '10SV','10SM','10SP'
  ]),

  'Goldwell Colorance': new Set([
    // High levels
    '10V','10P','10BS','10NA','10BG','10G','10GB','10N',
    '9N','9G','9K','9NA','9GB','9NN','9V','9B','9A','9AG','9VV','9RO','9GN',
    '8N','8G','8K','8GB','8NA','8NN','8V','8B','8A','8AG','8RO','8RB','8GN',
    '7N','7NN','7G','7GB','7K','7NA','7BA','7BG','7GG','7RO','7RB','7KG','7CA','7CT','7AX','7GN','7VV',
    '6N','6NN','6G','6GB','6K','6NA','6BA','6BG','6GG','6RO','6RB','6KG','6CA','6CT','6GN','6VV',
    '5N','5NN','5G','5GB','5K','5NA','5BA','5BG','5GG','5RO','5RB','5KG','5CA','5CT','5BM','5BG','5BV',
    '4N','4NN','4G','4GB','4K','4NA','4BA','4BG','4RO','4RB','4KG','4CA','4CT','4GN','4VV',
    '3N','3NN','3G','3GB','3K','3NA','3BA','3BG','3RO','3RB','3KG','3GN','3VV',
    '2N','2NN','2G','2GB','2K','2NA','2BA','2BG','2RO','2RB','2KG','2GN','2VV',
    '1N','1NN','1B','1BG','1BA',
    // Gloss Tones / pure toner series
    'P02','P03','P04','P05','P06','P09','P10',
    'Clear'
  ]),

  'Schwarzkopf Igora Vibrance': new Set([
    '0-00','0-0','0-11','0-22','0-33','0-44','0-55','0-66','0-77','0-88','0-99',
    '9-0','9-1','9-4','9-5','9-65','9-12','9-55','9-86',
    '8-0','8-1','8-4','8-46','8-05','8-11','8-88','8-77','8-65','8-55','8-68',
    '7-0','7-1','7-4','7-46','7-77','7-65','7-55','7-57','7-12','7-00',
    '6-0','6-1','6-4','6-46','6-77','6-65','6-55','6-57','6-12','6-88','6-99',
    '5-0','5-1','5-4','5-57','5-46','5-5','5-65','5-55','5-29','5-99',
    '4-0','4-1','4-4','4-88','4-68','4-65','4-55','4-57','4-99','4-29','4-46',
    '3-0','3-1','3-65','3-55','3-68','3-88','3-99',
    '2-0','2-1','2-5','2-4','2-99',
    '1-0','1-1','1-2','1-99'
  ]),

  'Pravana ChromaSilk Express Tones': new Set([
    'Platinum','Violet','Ash','Beige','Gold','Copper','Rose','Silver','Natural','Clear'
  ]),

  // PERMANENT
  'Redken Color Gels Lacquers': new Set([
    '10NA','10N','10NW','10NG',
    '9NA','9N','9GB','9NW','9VRo',
    '8GN','8AB','8NA','8NN','8N','8NW','8NG','8WG','8VRo','8GB','8GI','8RO','8RR',
    '7AB','7NA','7NN','7N','7GB','7NW','7NG','7RO','7RR',
    '6GN','6ABN','6NA','6NN','6N','6NW','6NG','6WG','6CB','6RO','6RR','6VRo',
    '5AB','5NA','5NN','5N','5GB','5NW','5NG','5CB','5RB','5RR','5VRo',
    '4ABN','4NA','4NN','4N','4NW','4NG','4WG','4CB','4RR','4RV','4VRo','4RO',
    '3NN','3N','3NW','3RB','3RO','3RV',
    '2ABN','2NW','2N','2NN','2NA',
    '1NW','1N','1NN','1NB',
    'CLEAR','Clear'
  ]),

  'Wella Koleston Perfect': new Set([
    // Special Blondes (12 and 11 series)
    '12/0','12/1','12/11','12/81','12/96','12/19','12/21','12/4','12/46','12/88',
    '11/0','11/1','11/11','11/8','11/81','11/96','11/65','11/89',
    // Level 10
    '10/0','10/1','10/3','10/38','10/6','10/81','10/95','10/96','10/8',
    // Level 9
    '9/0','9/01','9/1','9/3','9/16','9/38','9/4','9/43','9/7','9/73','9/81','9/96','9/37','9/55',
    // Level 8
    '8/0','8/1','8/04','8/03','8/31','8/38','8/41','8/43','8/4','8/7','8/73','8/81','8/96',
    // Level 7
    '7/0','7/1','7/03','7/3','7/31','7/35','7/37','7/41','7/43','7/44','7/45','7/4','7/5','7/57','7/7','7/73','7/75','7/77','7/81','7/86','7/89','7/96',
    // Level 6
    '6/0','6/1','6/03','6/3','6/31','6/35','6/37','6/4','6/43','6/45','6/5','6/7','6/73','6/75','6/77','6/81','6/88','6/99','6/02',
    // Level 5
    '5/0','5/1','5/03','5/3','5/37','5/4','5/43','5/5','5/55','5/7','5/75','5/77','5/81','5/88','5/99',
    // Level 4
    '4/0','4/07','4/1','4/3','4/35','4/4','4/57','4/66','4/6','4/7','4/77','4/88','4/99',
    // Level 3
    '3/0','3/1','3/03','3/3','3/4','3/66','3/6','3/5','3/77','3/88','3/99',
    // Level 2
    '2/0','2/1','2/3','2/4','2/5','2/6','2/7','2/8','2/99',
    // Level 1
    '1/0','1/1','1/2','1/4','1/6','1/7','1/9',
    // Special Mix (0/XX)
    '0/00','0/11','0/22','0/33','0/34','0/43','0/44','0/55','0/56','0/66','0/88','0/99'
  ]),

  'Wella Illumina Color': new Set([
    '10/1','10/05','10/36','10/38','10/69','10/93','10/95','10/96',
    '9/1','9/03','9/17','9/19','9/43','9/59','9/60','9/81','9/96','9/4','9/05','9/69',
    '8/1','8/05','8/37','8/43','8/69','8/74','8/93','8/96','8/81',
    '7/1','7/03','7/35','7/37','7/43','7/59','7/81','7/86','7/93','7/02','7/07',
    '6/1','6/02','6/37','6/43','6/45','6/59','6/7','6/9','6/76','6/81','6/96',
    '5/02','5/05','5/35','5/4','5/43','5/59','5/7','5/81','5/9',
    '4/07','4/37','4/52','4/6','4/75','4/81','4/9',
    '3/65','3/68','3/69','3/9'
  ]),

  'L’Oréal Professionnel Majirel': new Set([
    '10.1','10.12','10.21','10.22','10.23','10.3','10.31','10.32','10.8',
    '9.0','9.01','9.02','9.1','9.12','9.13','9.2','9.3','9.31','9.32','9.4','9.41','9.45','9.66','9.75',
    '8.0','8.01','8.02','8.1','8.12','8.13','8.2','8.3','8.31','8.34','8.4','8.41','8.45','8.43','8.44','8.66','8.73',
    '7.0','7.01','7.02','7.1','7.12','7.13','7.2','7.3','7.31','7.34','7.4','7.43','7.44','7.52','7.56','7.66','7.35',
    '6.0','6.01','6.02','6.1','6.12','6.13','6.2','6.3','6.31','6.34','6.4','6.41','6.45','6.35','6.5','6.52','6.54','6.56','6.62','6.66',
    '5.0','5.01','5.02','5.1','5.12','5.13','5.2','5.3','5.31','5.34','5.4','5.41','5.45','5.5','5.52','5.56','5.62','5.66','5.75',
    '4.0','4.01','4.02','4.1','4.12','4.13','4.2','4.3','4.31','4.35','4.4','4.45','4.5','4.52','4.56','4.62','4.65',
    '3.0','3.1','3.2','3.3','3.4','3.5','3.6','3.64','3.23','3.31',
    '2.0','1.0','1.1','1.2','1.3','1.4','1.5','1.6',
    '0.0','0.01','0.02','0.11','0.31','0.2','0.3','0.4','0.43','0.66'
  ]),

  'Matrix SoColor Permanent': new Set([
    '1N','2N','3N','4N','5N','6N','7N','8N','9N','10N',
    '2A','3A','4A','5A','6A','7A','8A','9A','10A',
    '3AA','4AA','5AA','6AA','7AA',
    '3B','4B','5B','6B','7B','8B',
    '3C','4C','5C','6C','7C','8C','9C',
    '3G','4G','5G','6G','7G','8G','9G','10G',
    '3M','4M','5M','6M','7M','8M','9M','10M',
    '3R','4R','5R','6R','7R','8R','9R','10R',
    '5RV','6RV','7RV','8RV','9RV','10RV',
    '5RC','6RC','7RC','8RC','9RC','10RC',
    '5VR','6VR','7VR','8VR','9VR',
    '5BC','6BC','7BC','8BC','9BC',
    '5MG','6MG','7MG','8MG','9MG',
    'UL-A','UL-N','UL-V','UL-M','UL-C',
    'HIB0','HIB1','HIB2','HIB3','HIB4','HIB5','HIB6'
  ]),

  'Goldwell Topchic': new Set([
    '10V','10P','10BS','10NA','10BG','10G','10GB','10B','10N',
    '9N','9G','9K','9GB','9NA','9NN','9V','9B','9A','9AG','9VV','9RO','9GN',
    '8N','8G','8K','8GB','8NA','8NN','8V','8B','8A','8AG','8RO','8RB','8GN',
    '7N','7G','7K','7GB','7NA','7NN','7V','7B','7A','7AG','7RO','7RB','7GN','7KG','7VV',
    '6N','6G','6K','6GB','6NA','6NN','6V','6B','6A','6AG','6RO','6RB','6GN','6KG','6VV',
    '5N','5G','5K','5GB','5NA','5NN','5V','5B','5A','5AG','5RO','5RB','5GN','5KG','5VV','5BG','5BV',
    '4N','4G','4K','4GB','4NA','4NN','4V','4B','4A','4AG','4RO','4RB','4GN','4KG','4VV',
    '3N','3G','3K','3GB','3NA','3NN','3V','3B','3A','3AG','3RO','3RB','3GN','3KG','3VV',
    '2N','2G','2K','2GB','2NA','2NN','2V','2B','2A','2AG','2RO','2RB','2GN','2KG','2VV',
    '1N','1NN','1A','1B','1BG','1BV',
    '0N','0G','0NA','0BG','0BP'
  ]),

  'Schwarzkopf Igora Royal': new Set([
    '12-0','12-1','12-2','12-11','12-19','12-21','12-4','12-46','12-88',
    '10-0','10-1','10-2','10-12','10-4','10-5','10-50','10-55','10-65','10-89',
    '9-0','9-1','9-12','9-4','9-5','9-55','9-60','9-65','9-88','9-9','9-98',
    '8-0','8-1','8-11','8-12','8-4','8-46','8-5','8-50','8-55','8-77','8-65','8-66','8-88','8-99',
    '7-0','7-1','7-12','7-4','7-46','7-5','7-57','7-55','7-65','7-77','7-88','7-89','7-99',
    '6-0','6-1','6-12','6-4','6-46','6-5','6-57','6-65','6-77','6-88','6-99',
    '5-0','5-1','5-12','5-4','5-46','5-5','5-57','5-65','5-77','5-88','5-99',
    '4-0','4-1','4-12','4-4','4-46','4-5','4-57','4-65','4-77','4-88','4-99',
    '3-0','3-1','3-12','3-4','3-46','3-5','3-65','3-68','3-77','3-88','3-99',
    '2-0','2-1','2-2','2-4','2-5','2-6','2-7','2-8','2-99',
    '1-0','1-1','1-2','1-3','1-4','1-5','1-6','1-7','1-9','1-99'
  ]),

  'Pravana ChromaSilk Permanent Crème Color': new Set([
    '1N','1B','1V','1R','1A','1NB','1RV','1B',
    '2N','2B','2V','2R','2A','2NB','2RV','2B',
    '3N','3B','3V','3R','3A','3NB','3RV','3B','3VV','3RR',
    '4N','4B','4V','4R','4A','4NB','4RV','4B','4VV','4RR',
    '5N','5B','5V','5R','5A','5NB','5RV','5B','5VV','5RR','5.52','5.5','5.7',
    '6N','6B','6V','6R','6A','6NB','6RV','6B','6VV','6RR','6.11','6.23','6.4','6.66',
    '7N','7B','7V','7R','7A','7NB','7RV','7B','7VV','7RR','7.4','7.66','7.11','7.40','7.44',
    '8N','8B','8V','8R','8A','8NB','8RV','8B','8VV','8RR','8.1','8.2','8.3','8.4','8.44','8.6','8.66','8.73',
    '9N','9B','9V','9R','9A','9NB','9RV','9B','9VV','9RR','9.1','9.2','9.31','9.4','9.44','9.7','9.66','9.9',
    '10N','10B','10V','10R','10A','10NB','10RV','10B','10VV','10RR','10.1','10.2','10.3','10.31','10.32','10.7',
    '11.1','11.2','11.3','11.4','11.7','11.8',
    '12.1','12.2','12.3','12.4','12.7','12.8'
  ]),

  // SEMI
  'Wella Color Fresh': new Set([
    '10/0','9/03','8/81','8/03','7/0','7/43','6/07','6/0','5/07','5/55','4/0','3/0','2/0','1/0','5/75','6/7','7/46','8/0','9/16','8/32','6/45','5/5','6/5','9/34','7/34','6/4','7/44','10/81','9/36','8/7','7/1','4/71','3/66','2/8','0/00','0/89'
  ]),

  'Goldwell Elumen': new Set([
    '@Clear','Clear','@ALL','@PK','@RR','@RV','@RO','@AN','@AB','@VV','@GB','@GK','@GG','@BN','@BR','@BL','@GV','@KY','@YS','@TQ','@Gk','@NA','@NE','@Si','@SV','@PL','@SA','@SB','@SR','@UU','@CF','@CM','@DC','@DE'
  ]),

  'Pravana ChromaSilk Vivids': new Set([
    'Silver','Clear','Magenta','Pink','Blue','Green','Yellow','Orange','Red','Purple','Teal','Wild Orchid','Blissful Blue','Locked-In Yellow','Locked-In Orange','Locked-In Red','Locked-In Teal','Locked-In Blue','Locked-In Purple','Neon Yellow','Neon Orange','Neon Pink','Neon Blue','Neon Green','Pastel Pink','Pastel Coral','Pastel Purple','Pastel Blue','Pastel Green','Mystical Mint','Too Cute Coral','Pretty in Pink','Luscious Lavender','Smokey Silver','Moody Blue','Black','Espresso','Rouge','Violet','Sunset Coral','Tangerine'
  ]),

  'Schwarzkopf Chroma ID': new Set([
    '9-12','9-5','8-46','7-12','7-7','7-77','7-777','6-12','6-46','5-1','5-2','5-99','4-19','4-99','3-65','3-88','3-99','Clear','Bonding','Pastel'
  ]),

  'Matrix SoColor Cult': new Set([
    'Clear','Neon Yellow','Neon Green','Neon Orange','Neon Pink','Neon Blue','Neon Purple','Teal','Pink','Blue','Purple','Red','Orange','Yellow','Magenta','Mint','Aqua','Rose Gold','Crimson','Ruby','Lavender','Fuchsia','Coral','Lilac','Midnight Blue','Dark Purple','Neon Watermelon','Neon Lime','Smoky Lavender','Graphite','Pearl Grey','Emerald','Sunset Orange','Canary Yellow','Flamingo Pink','True Blue','True Purple','True Teal','True Red','True Orange','True Yellow','Pastel Pink','Pastel Blue','Pastel Green','Pastel Purple','Pastel Coral','Pastel Teal'
  ]),
};

// -------------------------------------------------------------------------
// Hard validation helpers
//
// The purpose of the following helpers is to guarantee that a generated
// formula references only legitimate shade codes or names and that it
// explicitly includes the official mixing ratio and developer name for the
// selected brand. If a scenario fails validation, the agentic retry
// wrapper will re-prompt the model with additional guidance. On the
// second failure a safe fallback is returned.

// Extract potential shade codes from a formula string.  This strips
// parentheses (ratios) and any trailing developer info then splits on
// plus signs.  We do not split on dashes or slashes because many
// brands incorporate those characters into the code itself.  The first
// token of each segment is treated as the shade code.
function extractCodes(formula) {
  if (!formula) return [];
  // Remove ratio parentheses e.g. (1:1.5)
  let cleaned = formula.replace(/\([^)]*\)/g, '');
  // Remove developer portion beginning with 'with'
  cleaned = cleaned.split(/\bwith\b/i)[0];
  // Split on plus signs which separate multiple shades
  const parts = cleaned.split('+');
  const codes = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Shade code is first contiguous token up to whitespace
    const token = trimmed.split(/\s+/)[0];
    // Ignore if the token is something like 'N/A'
    if (/^n\/a/i.test(token)) continue;
    codes.push(token);
  }
  return codes;
}

// Determine if a formula includes the correct ratio and developer for
// a given brand.  For brands with RTU (ready‑to‑use) formulas the
// expectation is that neither a ratio nor a developer string should
// appear; for all other brands at least one recognised ratio from the
// brand rule must be present and the canonical developer name must be
// mentioned.  Goldwell Colorance accepts both 2:1 and 1:1 ratios.
function stepHasRatioAndDeveloper(step, brand) {
  if (!step || !step.formula) return true;
  const formula = step.formula;
  // Skip N/A formulas
  if (/^\s*n\/a/i.test(formula)) return true;
  const rule = BRAND_RULES[brand];
  if (!rule) return true;
  const ratioField = rule.ratio || '';
  const canonicalDev = canonicalDeveloperName(brand);
  // Determine allowed ratio list
  let ratioList = [];
  if (/RTU/i.test(ratioField)) {
    ratioList = [];
  } else if (brand === 'Goldwell Colorance') {
    // Core Colorance is 2:1, Gloss Tones 1:1
    ratioList = ['2:1','1:1'];
  } else {
    ratioList = [ratioField.trim()];
  }
  // Check for presence of ratio
  if (ratioList.length > 0) {
    const ratioPresent = ratioList.some(r => {
      const escaped = r.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const rx = new RegExp(escaped.replace(/\s*/g, '\\s*'), 'i');
      return rx.test(formula);
    });
    if (!ratioPresent) return false;
  } else {
    // RTU brands should not include a ratio or developer
    if (/\d\s*:\s*\d/.test(formula)) return false;
  }
  // Check developer presence for brands requiring developer
  if (canonicalDev) {
    const devRx = new RegExp(canonicalDev.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i');
    if (!devRx.test(formula)) return false;
  } else {
    // For RTU or no developer lines, ensure we didn’t include a developer
    if (/\bwith\b/i.test(formula)) return false;
  }
  return true;
}

// Validate all scenarios against allow-lists and ratio/developer rules.  Returns
// an object indicating success and, when failing, a descriptive reason.
function validateAgainstAllowList(out, brand) {
  if (!out || !Array.isArray(out.scenarios)) return { valid: true };
  const allowed = BRAND_ALLOWLISTS[brand];
  // If we have no explicit allow-list for this brand we cannot validate codes
  if (!allowed) return { valid: true };
  for (const sc of out.scenarios) {
    for (const key of ['roots','melt','ends']) {
      const step = sc[key];
      if (!step || !step.formula) continue;
      const formula = step.formula;
      // Skip N/A entries (used for Express Tones guard)
      if (/^\s*n\/a/i.test(formula)) continue;
      // Extract codes and validate membership
      const codes = extractCodes(formula);
      for (const code of codes) {
        // Some formulas include parentheses but we trimmed them; treat uppercase
        const keyCode = code.trim();
        if (!allowed.has(keyCode) && !allowed.has(keyCode.toUpperCase()) && !allowed.has(keyCode.toLowerCase())) {
          return { valid: false, reason: `Unrecognized shade(s) for ${brand}` };
        }
      }
      // Validate ratio and developer rules
      if (!stepHasRatioAndDeveloper(step, brand)) {
        return { valid: false, reason: `Missing or incorrect ratio/developer for ${brand}` };
      }
    }
  }
  return { valid: true };
}

// Agentic retry wrapper.  Executes the model once and validates the result.
// On failure, retries once with a stricter prompt; if still invalid,
// constructs a safe fallback.  Always applies brand consistency and
// other guards before validation.  Collapses scenarios for demi/semi
// categories.
async function generateWithAgent({ category, brand, dataUrl }) {
  let lastInvalidReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const extraSystem = attempt === 1
      ? 'Use only real codes/names from the selected brand’s allow‑list. Don’t invent. Include official ratio and the exact developer name.'
      : '';
    // Generate candidate JSON from the model
    let out = await chatAnalyze({ category, brand, dataUrl, extraSystem });
    // Apply existing enforcement logic
    out = enforceBrandConsistency(out, brand);
    out = expressTonesGuard(out, out.analysis, brand);
    out = enforceNeutralBlack(out, out.analysis, brand);
    out = applyValidator(out, category, brand);
    // Validate against allow-list and ratio/developer rules
    const validation = validateAgainstAllowList(out, brand);
    if (validation.valid) {
      // Only after validation run the primary scenario trimmer to remove
      // cross‑brand codes; if codes are valid nothing will be removed.
      out = validatePrimaryScenario(out, brand);
      // Collapse scenarios for demi and semi categories
      if (category !== 'permanent' && Array.isArray(out.scenarios)) {
        const primary = out.scenarios.find(s => (s.title || '').toLowerCase().includes('primary')) || out.scenarios[0];
        out.scenarios = primary ? [primary] : [];
      }
      return out;
    }
    lastInvalidReason = validation.reason || 'Invalid formulation';
  }
  // Safe fallback: return a minimal response explaining why
  const message = lastInvalidReason || `Unrecognized shade(s) for ${brand}`;
  const safe = {
    analysis: message,
    scenarios: [
      {
        title: 'Primary plan',
        condition: null,
        target_level: null,
        roots: null,
        melt: null,
        ends: { formula: `N/A — ${message}.`, timing: '', note: null },
        processing: [message],
        confidence: 0.0
      }
    ]
  };
  return safe;
}


// ------------------------ Manufacturer Mixing Rules ------------------------
const BRAND_RULES = {
  // PERMANENT
  'Redken Color Gels Lacquers': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Redken Pro-oxide Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1; 20 vol typical for grey coverage.'
  },
  'Wella Koleston Perfect': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9%/12%',
    notes: 'Core shades 1:1.'
  },
  'Wella Illumina Color': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Welloxon Perfect 3%/6%/9%',
    notes: 'Reflective permanent; 1:1 mix.'
  },
  'L’Oréal Professionnel Majirel': {
    category: 'permanent',
    ratio: '1:1.5',
    developer: 'L’Oréal Oxydant Creme',
    notes: 'Standard Majirel 1:1.5. (High Lift lines may be 1:2).'
  },
  'Matrix SoColor Permanent': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Matrix Cream Developer 10/20/30/40 vol',
    notes: 'Standard 1:1. (Ultra.Blonde 1:2; HIB 1:1.5 exceptions).'
  },
  'Goldwell Topchic': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'Goldwell Topchic Developer Lotion 6%/9%/12%',
    notes: 'Most shades 1:1.'
  },
  'Schwarzkopf Igora Royal': {
    category: 'permanent',
    ratio: '1:1',
    developer: 'IGORA Oil Developer 3%/6%/9%/12%',
    notes: 'Standard 1:1.'
  },
  'Pravana ChromaSilk Permanent Crème Color': {
    category: 'permanent',
    ratio: '1:1.5',
    developer: 'PRAVANA Crème Developer 10/20/30/40 vol',
    notes: 'ChromaSilk 1:1.5 (High Lifts 1:2).'
  },

  // DEMI (deposit-only)
  'Redken Shades EQ': {
    category: 'demi',
    ratio: '1:1',
    developer: 'Shades EQ Processing Solution',
    notes: 'Acidic gloss; up to ~20 minutes typical.'
  },
  'Wella Color Touch': {
    category: 'demi',
    ratio: '1:2',
    developer: 'Color Touch Emulsion 1.9% or 4%',
    notes: 'Standard 1:2.'
  },
  'Paul Mitchell The Demi': {
    category: 'demi',
    ratio: '1:1',
    developer: 'The Demi Processing Liquid',
    notes: 'Mix 1:1.'
  },
  'Matrix SoColor Sync': {
    category: 'demi',
    ratio: '1:1',
    developer: 'SoColor Sync Activator',
    notes: 'Mix 1:1.'
  },
  'Goldwell Colorance': {
    category: 'demi',
    ratio: '2:1',
    developer: 'Colorance System Developer Lotion 2% (7 vol)',
    notes: 'Core Colorance 2:1 (lotion:color). **Gloss Tones = 1:1**.'
  },
  'Schwarzkopf Igora Vibrance': {
    category: 'demi',
    ratio: '1:1',
    developer: 'IGORA VIBRANCE Activator Gel (1.9%/4%) OR Activator Lotion (1.9%/4%)',
    notes: 'All shades 1:1; name Gel or Lotion.'
  },
  'Pravana ChromaSilk Express Tones': {
    category: 'demi',
    ratio: '1:1.5',
    developer: 'PRAVANA Zero Lift Creme Developer',
    notes: '**5 minutes only; watch visually. Use shade names (Violet, Platinum, Ash, Beige, Gold, Copper, Rose, Silver, Natural, Clear). Do NOT use level codes.**'
  },

  // SEMI (direct / RTU)
  'Wella Color Fresh': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Ready-to-use acidic semi.'
  },
  'Goldwell Elumen': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Use Elumen Prepare/Lock support; no developer.'
  },
  'Pravana ChromaSilk Vivids': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; dilute with Clear if needed.'
  },
  'Schwarzkopf Chroma ID': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye; dilute with Clear Bonding Mask.'
  },
  'Matrix SoColor Cult': {
    category: 'semi',
    ratio: 'RTU',
    developer: 'None',
    notes: 'Direct dye (no developer).'
  },
};

// ------------------------------ Utilities ----------------------------------
function canonList(arr) {
  const map = new Map();
  for (const label of arr) map.set(label.toLowerCase(), label);
  return map;
}
const DEMI_MAP = canonList(DEMI_BRANDS);
const PERM_MAP = canonList(PERMANENT_BRANDS);
const SEMI_MAP = canonList(SEMI_BRANDS);

function normalizeBrand(category, input) {
  const s = (input || '').trim().toLowerCase();
  const pool =
    category === 'permanent' ? PERM_MAP :
    category === 'semi'      ? SEMI_MAP  :
                               DEMI_MAP;

  if (pool.has(s)) return pool.get(s);

  // fuzzy
  for (const [k, v] of pool.entries()) {
    const head = k.split(' ')[0];
    const tail = k.split(' ').slice(-1)[0];
    if (s.includes(head) && s.includes(tail)) return v;
    if (s.includes(head) || s.includes(tail)) return v;
  }
  // defaults
  if (category === 'permanent') return 'Redken Color Gels Lacquers';
  if (category === 'semi')      return 'Wella Color Fresh';
  return 'Redken Shades EQ';
}

// developer display name (short)
function canonicalDeveloperName(brand) {
  const rule = BRAND_RULES[brand];
  if (!rule || !rule.developer || rule.developer === 'None') return null;
  let first = rule.developer.split(/\s*\/\s*|\s+or\s+|\s+OR\s+/)[0];
  first = first.replace(/\d+%/g, '')
               .replace(/\b(10|20|30|40)\s*vol(ume)?\b/ig, '')
               .replace(/\([^)]*\)/g, '')
               .replace(/\s{2,}/g, ' ')
               .trim();
  return first || null;
}

// Insert ratio + developer where missing
function enforceRatioAndDeveloper(formula, brand) {
  const rule = BRAND_RULES[brand];
  if (!rule) return formula;
  let out = (formula || '').trim();

  const devName = canonicalDeveloperName(brand);
  if (devName && !new RegExp(devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) {
    if (/ with /i.test(out)) out = out.replace(/ with /i, ` with ${devName} `);
    else out = `${out} with ${devName}`;
  }

  const r = (rule.ratio || '').trim();
  const isSimpleRatio = /^(\d+(\.\d+)?):(\d+(\.\d+)?)$/.test(r);
  if (isSimpleRatio) {
    const ratioRegex = /(\d+(\.\d+)?)[ ]*:[ ]*(\d+(\.\d+)?)/;
    if (!ratioRegex.test(out)) {
      if (/ with /i.test(out)) out = out.replace(/ with /i, ` (${r}) with `);
      else out = `${out} (${r})`;
    }
  }
  return out.trim();
}

function fixStep(step, brand) {
  if (!step) return null;
  const patched = { ...step };
  if (patched.formula) patched.formula = enforceRatioAndDeveloper(patched.formula, brand);
  return patched;
}

// brand timing overrides
function timingOverride(step, brand) {
  if (!step) return step;
  const s = { ...step };
  if (brand === 'Pravana ChromaSilk Express Tones') {
    s.timing = 'Process 5 minutes only; watch visually.';
  }
  return s;
}

function enforceBrandConsistency(out, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  const patched = { ...out, scenarios: out.scenarios.map(sc => {
    const s = { ...sc };
    s.roots = timingOverride(fixStep(s.roots, brand), brand);
    s.melt  = timingOverride(fixStep(s.melt,  brand), brand);
    s.ends  = timingOverride(fixStep(s.ends,  brand), brand);
    return s;
  })};
  return patched;
}

// -------------------------- Shade Format Validators -------------------------
const BRAND_PATTERNS = {
  // DEMI
  'Redken Shades EQ': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Wella Color Touch': [/^\s*[1-9]\/\d{1,2}\b/],
  'Paul Mitchell The Demi': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Matrix SoColor Sync': [/^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  'Goldwell Colorance': [/^\s*\d{1,2}[A-Z@]{1,3}\b/],
  'Schwarzkopf Igora Vibrance': [/^\s*\d{1,2}-\d{1,2}\b/, /^\s*0?\d{1,2}[A-Z]{1,3}\b/],
  // Names only for Express Tones:
  'Pravana ChromaSilk Express Tones': [/^\s*(?:Platinum|Violet|Ash|Beige|Gold|Copper|Rose|Silver|Natural|Clear)\b/i],

  // SEMI
  'Wella Color Fresh': [/^\s*(?:\d{1,2}\.\d|\d{1,2})\b/],
  'Goldwell Elumen': [/^\s*(?:@[\w]+|\w+-\w+|\w{1,2}\d{1,2})\b/],
  'Pravana ChromaSilk Vivids': [/^\s*(?:VIVIDS|Silver|Clear|Magenta|Pink|Blue|Green|Yellow|Orange|Red|Purple)\b/i],
  'Schwarzkopf Chroma ID': [/^\s*(?:\d{1,2}-\d{1,2}|Clear|Bonding)\b/i],
  'Matrix SoColor Cult': [/^\s*(?:Clear|Neon|Pastel|Teal|Pink|Blue|Purple|Red)\b/i],
};

function stepHasAllowedCodes(step, brand) {
  if (!step || !step.formula) return true;
  const pats = BRAND_PATTERNS[brand] || [];
  if (pats.length === 0) return true;
  return pats.some(rx => rx.test(step.formula));
}

// -------------------- Analysis-aware guard (Pravana Express) ----------------
function expressTonesGuard(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios) || brand !== 'Pravana ChromaSilk Express Tones') return out;
  const a = (analysis || '').toLowerCase();

  const isJetBlack = /\b(level\s*1|level\s*2|jet\s*black|solid\s*black)\b/.test(a);
  const wantsVividRed = /\b(vivid|vibrant|rich)\s+red\b/.test(a) || /\b(cherry|ruby|crimson|scarlet)\b/.test(a);

  // Not suitable on level 1–2 black (don't suggest Clear)
  if (isJetBlack) {
    const ends = { formula: 'N/A — Express Tones require pre-lightened level 8–10; use PRAVANA VIVIDS or a permanent plan.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan',
      condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Not applicable for this photo with Express Tones.'],
      confidence: 0.85
    }];
    return out;
  }

  // For vivid/rich red inspo, Rose won’t create saturation: recommend Vivids first
  if (wantsVividRed) {
    const ends = { formula: 'N/A — Express Tones are toners. For saturated red, formulate with PRAVANA VIVIDS Red/Copper; optional quick 5-min Express Tones Rose overlay only on pre-lightened hair.', timing: '', note: null };
    out.scenarios = [{
      title: 'Primary plan',
      condition: null, target_level: null, roots: null, melt: null, ends,
      processing: ['Use PRAVANA VIVIDS for saturation; gloss later if needed.'],
      confidence: 0.85
    }];
    return out;
  }

  // Warm blonde steer
  const wantsWarmBlonde = /\b(warm|golden|honey|caramel)\b.*\bblonde\b/.test(a) || /\bwarm blonde\b/.test(a);
  if (wantsWarmBlonde && out.scenarios[0]) {
    const s = out.scenarios[0];
    const ends = s.ends || { formula: '', timing: '', note: null };
    ends.formula = 'Beige + Gold (1:1.5) with PRAVANA Zero Lift Creme Developer';
    ends.timing = 'Process 5 minutes only; watch visually.';
    out.scenarios[0] = { ...s, ends };
  }
  return out;
}

// --------------------- Alternate/Primary validators (generic) ---------------
function isBlackOrSingleVivid(analysis) {
  const a = (analysis || '').toLowerCase();
  const black = /\b(level\s*[12]\b|solid\s*black)\b/.test(a);
  const vividHint = /\b(single\s+vivid|vivid|fashion\s+shade|magenta|pink|blue|green|purple|teal|neon)\b/.test(a);
  return black || vividHint;
}

function extractNumericLevels(text) {
  const levels = [];
  const rx = /\b0?([1-9]|1[0-2])\s*[A-Z@]?/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n)) levels.push(n);
  }
  return levels;
}

function altHasHighLevelToner(sc) {
  const parts = [sc?.roots?.formula, sc?.melt?.formula, sc?.ends?.formula].filter(Boolean).join(' ');
  const lvls = extractNumericLevels(parts);
  return lvls.some(n => n >= 7);
}

function applyValidator(out, category, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (category === 'permanent') return out;
  const patched = { ...out };
  patched.scenarios = out.scenarios.map(sc => {
    const s = { ...sc };
    const title = (s.title || '').toLowerCase();
    const isAlternate = title.includes('alternate');
    if (!isAlternate) return s;

    if (isBlackOrSingleVivid(out.analysis) || altHasHighLevelToner(s)) {
      s.na = true;
      s.note = 'Not applicable for this photo/brand line.';
      return s;
    }
    const rootsOK = stepHasAllowedCodes(s.roots, brand);
    const meltOK  = stepHasAllowedCodes(s.melt,  brand);
    const endsOK  = stepHasAllowedCodes(s.ends,  brand);
    if (!(rootsOK && meltOK && endsOK)) {
      s.na = true;
      s.note = 'Not applicable for this photo/brand line.';
    }
    return s;
  });
  return patched;
}

// Validate primary too (prevents cross-brand codes)
function validatePrimaryScenario(out, brand) {
  if (!out || !Array.isArray(out.scenarios) || out.scenarios.length === 0) return out;
  const s = out.scenarios[0];
  const rootsOK = stepHasAllowedCodes(s.roots, brand);
  const meltOK  = stepHasAllowedCodes(s.melt,  brand);
  const endsOK  = stepHasAllowedCodes(s.ends,  brand);
  if (!(rootsOK && meltOK && endsOK)) {
    s.processing = s.processing || [];
    s.processing.unshift('Adjusted: removed non-brand shade codes.');
    if (s.roots && !rootsOK && s.roots.formula) s.roots.formula = s.roots.formula.replace(/^[^\s]+/, '').trim();
    if (s.melt  && !meltOK  && s.melt.formula)  s.melt.formula  = s.melt.formula.replace(/^[^\s]+/, '').trim();
    if (s.ends  && !endsOK  && s.ends.formula)  s.ends.formula  = s.ends.formula.replace(/^[^\s]+/, '').trim();
  }
  return out;
}

// -------------------- NEW: Normalize 1–2 black to 1N on supported lines -----
const N_SERIES_BLACK_BRANDS = new Set([
  'Redken Shades EQ',
  'Paul Mitchell The Demi',
  'Matrix SoColor Sync',
  'Goldwell Colorance',
]);

function isLevel12Black(analysis) {
  const a = (analysis || '').toLowerCase();
  return /\b(level\s*1(\s*[-–]\s*2)?|level\s*2|deep\s+black|jet\s+black|solid\s+black)\b/.test(a);
}

function replace1Awith1N(step) {
  if (!step || !step.formula) return step;
  return { ...step, formula: step.formula.replace(/\b1A\b/g, '1N') };
}

function enforceNeutralBlack(out, analysis, brand) {
  if (!out || !Array.isArray(out.scenarios)) return out;
  if (!N_SERIES_BLACK_BRANDS.has(brand)) return out;
  if (!isLevel12Black(analysis)) return out;

  const scenarios = out.scenarios.map(sc => {
    const s = { ...sc };
    s.roots = replace1Awith1N(s.roots);
    s.melt  = replace1Awith1N(s.melt);
    s.ends  = replace1Awith1N(s.ends);
    return s;
  });
  return { ...out, scenarios };
}

// ---------------------------- Prompt Builders ------------------------------
const SHARED_JSON_SHAPE = `
Return JSON only, no markdown. Use exactly this shape:

{
  "analysis": "<1 short sentence>",
  "scenarios": [
    {
      "title": "Primary plan",
      "condition": null,
      "target_level": null,
      "roots": null | { "formula": "...", "timing": "...", "note": null },
      "melt":  null | { "formula": "...", "timing": "...", "note": null },
      "ends":  { "formula": "...", "timing": "...", "note": null },
      "processing": ["Step 1...", "Step 2...", "Rinse/condition..."],
      "confidence": 0.0
    },
    { "title": "Alternate (cooler)", "condition": null, "target_level": null, "roots": null|{...}, "melt": null|{...}, "ends": {...}, "processing": ["..."], "confidence": 0.0 },
    { "title": "Alternate (warmer)", "condition": null, "target_level": null, "roots": null|{...}, "melt": null|{...}, "ends": {...}, "processing": ["..."], "confidence": 0.0 }
  ]
}
`.trim();

function brandRuleLine(brand) {
  const r = BRAND_RULES[brand];
  if (!r) return '';
  return `Official mixing rule for ${brand}: ratio ${r.ratio}; developer/activator: ${r.developer}. ${r.notes}`;
}

function buildSystemPrompt(category, brand) {
  const header = `You are Formula Guru, a master colorist. Use only: "${brand}". Output must be JSON-only and match the app schema.`;
  const brandRule = brandRuleLine(brand);
  const ratioGuard = `
IMPORTANT — MIXING RULES
- Use the **official mixing ratio shown below** for ${brand} in ALL formula strings.
- Include the **developer/activator product name** exactly as provided below when applicable.
- Only use exception ratios (e.g., high-lift or pastel/gloss) if clearly relevant, and state the reason.
${brandRule}
`.trim();

  if (category === 'permanent') {
    return `
${header}

CATEGORY = PERMANENT (root gray coverage)
${ratioGuard}

Goal: If the photo shows greys at the root, estimate grey % (<25%, 25–50%, 50–75%, 75–100%) and provide a firm ROOT COVERAGE formula that matches the mids/ends.

Rules:
- Anchor coverage with a natural/neutral series for ${brand}; add supportive tone to match the photo.
- Include **developer volume and the exact ratio** in the ROOTS formula (e.g., "6N + 6.3 (${BRAND_RULES[brand]?.ratio || '1:1'}) with 20 vol <developer>").
- Provide a compatible mids/ends plan (refresh vs. band control).
- Processing must call out: sectioning, application order (roots → mids → ends), timing, and rinse/aftercare.
- Return exactly 3 scenarios: Primary, Alternate (cooler), Alternate (warmer).

${SHARED_JSON_SHAPE}
`.trim();
  }

  if (category === 'semi') {
    return `
${header}

CATEGORY = SEMI-PERMANENT (direct/acidic deposit-only; ${brand})
${ratioGuard}

Rules:
- **No developer** in formulas (RTU where applicable). Use brand Clear/diluter for sheerness.
- Do not promise full grey coverage; you may blend/soften the appearance of grey.
- Return up to 3 scenarios:
  - Primary (always required)
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic and available**.
- If the photo shows level 1–2 / jet black, mark alternates **Not applicable**.
- Do not invent shade codes. Only use codes that exist for ${brand}.

${SHARED_JSON_SHAPE}
`.trim();
  }

  // Demi
  return `
${header}

CATEGORY = DEMI (gloss/toner; brand-consistent behavior)
${ratioGuard}

Rules:
- Gloss/toner plans only from ${brand}. In **every formula**, include the ratio and the **developer/activator name**.
- Keep processing up to ~20 minutes unless brand guidance requires otherwise.
- No lift promises; no grey-coverage claims.
- Return up to 3 scenarios:
  - Primary (always required)
  - Alternate (cooler) and/or Alternate (warmer) **only if realistic and available**.
- If level 1–2 black or single-vivid context, mark alternates **Not applicable**.
- Do not invent shade codes. Only use codes that exist for ${brand}.

${SHARED_JSON_SHAPE}
`.trim();
}

// -------------------------- OpenAI Call Helper -----------------------------
async function chatAnalyze({ category, brand, dataUrl, extraSystem = '' }) {
  // When called with an extraSystem field, append it to the system prompt. This
  // enables the agentic retry wrapper to instruct the model to adhere to
  // stricter rules on the second attempt. If extraSystem is undefined,
  // buildSystemPrompt returns the standard prompt.
  const extra = arguments[0]?.extraSystem || '';
  const system = buildSystemPrompt(category, brand) + (extra ? `\n\n${extra}` : '');

  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: `Analyze the attached photo. Category: ${category}. Brand: ${brand}. Provide 3 scenarios following the JSON schema.` },
        { type: 'image_url', image_url: { url: dataUrl } }
      ],
    },
  ];

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.25,
    response_format: { type: 'json_object' },
  });

  const text = resp.choices?.[0]?.message?.content?.trim() || '{}';
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}$/);
    return m ? JSON.parse(m[0]) : { analysis: 'Parse error', scenarios: [] };
  }
}

// --------------------------------- Routes ----------------------------------
app.get('/brands', (req, res) => {
  res.json({ demi: DEMI_BRANDS, permanent: PERMANENT_BRANDS, semi: SEMI_BRANDS });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/analyze', upload.single('photo'), async (req, res) => {
  let tmpPath;
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(401).json({ error: 'Missing OPENAI_API_KEY' });
    if (!req.file) return res.status(400).json({ error: "No photo uploaded (field 'photo')." });

    const categoryRaw = (req.body?.category || 'demi').toString().trim().toLowerCase();
    const category = ['permanent', 'semi', 'demi'].includes(categoryRaw) ? categoryRaw : 'demi';
    const brand = normalizeBrand(category, req.body?.brand);

    tmpPath = req.file.path;
    const mime = req.file.mimetype || 'image/jpeg';
    const b64 = await fs.readFile(tmpPath, { encoding: 'base64' });
    const dataUrl = `data:${mime};base64,${b64}`;

    // Generate and validate output via the agentic wrapper.  This
    // performs the OpenAI call, applies all enforcement guards, runs
    // validation against brand allow‑lists and ratio/developer rules, and
    // retries once with a stricter prompt if necessary.  It also
    // collapses scenarios for demi and semi categories.
    const out = await generateWithAgent({ category, brand, dataUrl });
    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Upstream error', detail: String(err?.message || err) });
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch {}
    }
  }
});

// ------------------------------------------------------------------------
// Self‑test endpoint
//
// Provides a basic sanity check for the validator logic.  Each test
// constructs a minimal JSON output and invokes the validator pipeline to
// verify that legitimate formulas pass and invalid ones are caught.  It
// does NOT call the OpenAI API.  The test names are descriptive and
// illustrate the scenario being checked.
app.get('/selftest', (_req, res) => {
  const tests = [];

  function addTest(name, fn) {
    try {
      const result = fn();
      tests.push({ name, pass: !!result });
    } catch {
      tests.push({ name, pass: false });
    }
  }

  // Helper to build a minimal out object for validation
  function buildOut(formula, analysis = '') {
    return {
      analysis,
      scenarios: [
        {
          title: 'Primary plan',
          condition: null,
          target_level: null,
          roots: null,
          melt: null,
          ends: formula ? { formula, timing: '', note: null } : null,
          processing: [],
          confidence: 0.5,
        },
      ],
    };
  }

  // Test 1: Valid Redken Shades EQ formula
  addTest('Redken Shades EQ valid shade', () => {
    const brand = 'Redken Shades EQ';
    const out = enforceBrandConsistency(buildOut('07NB (1:1) with Shades EQ Processing Solution'), brand);
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 2: Redken Shades EQ missing developer should fail (no insertion for test)
  addTest('Redken Shades EQ missing developer', () => {
    const brand = 'Redken Shades EQ';
    const out = buildOut('07NB (1:1)');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 3: Wella Color Touch cross‑brand code (using Redken code) should fail
  addTest('Wella Color Touch cross-brand code fails', () => {
    const brand = 'Wella Color Touch';
    const out = buildOut('07NB (1:2) with Color Touch Emulsion 1.9%');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 4: Wella Color Touch valid code passes
  addTest('Wella Color Touch valid code', () => {
    const brand = 'Wella Color Touch';
    const out = buildOut('7/43 (1:2) with Color Touch Emulsion 4%');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 5: Paul Mitchell The Demi valid formula passes
  addTest('Paul Mitchell The Demi valid', () => {
    const brand = 'Paul Mitchell The Demi';
    const out = buildOut('6A (1:1) with The Demi Processing Liquid');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 6: Matrix SoColor Sync missing ratio fails
  addTest('Matrix SoColor Sync missing ratio', () => {
    const brand = 'Matrix SoColor Sync';
    const out = buildOut('6A with SoColor Sync Activator');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 7: Redken Color Gels Lacquers valid formula passes
  addTest('Redken Color Gels Lacquers valid', () => {
    const brand = 'Redken Color Gels Lacquers';
    const out = buildOut('6NW + 6NG (1:1) with Redken Pro-oxide Cream Developer');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 8: Redken Color Gels Lacquers invalid code fails
  addTest('Redken Color Gels Lacquers invalid code', () => {
    const brand = 'Redken Color Gels Lacquers';
    const out = buildOut('6Z (1:1) with Redken Pro-oxide Cream Developer');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 9: Goldwell Colorance valid core ratio passes
  addTest('Goldwell Colorance valid 2:1', () => {
    const brand = 'Goldwell Colorance';
    const out = buildOut('7GB (2:1) with Colorance System Developer Lotion 2%');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 10: Goldwell Colorance valid gloss ratio passes
  addTest('Goldwell Colorance valid 1:1', () => {
    const brand = 'Goldwell Colorance';
    const out = buildOut('P02 (1:1) with Colorance System Developer Lotion 2%');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 11: Goldwell Colorance missing ratio fails
  addTest('Goldwell Colorance missing ratio', () => {
    const brand = 'Goldwell Colorance';
    const out = buildOut('7GB with Colorance System Developer Lotion 2%');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 12: Express Tones valid name passes
  addTest('Pravana Express Tones valid', () => {
    const brand = 'Pravana ChromaSilk Express Tones';
    const out = buildOut('Rose (1:1.5) with PRAVANA Zero Lift Creme Developer');
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 13: Express Tones invalid code fails
  addTest('Pravana Express Tones invalid code', () => {
    const brand = 'Pravana ChromaSilk Express Tones';
    const out = buildOut('09NB (1:1.5) with PRAVANA Zero Lift Creme Developer');
    return !validateAgainstAllowList(out, brand).valid;
  });
  // Test 14: Express Tones level 1 black triggers guard and passes because N/A
  addTest('Express Tones guard triggers', () => {
    const brand = 'Pravana ChromaSilk Express Tones';
    const analysis = 'The client has level 1 black hair';
    let out = buildOut('Rose (1:1.5) with PRAVANA Zero Lift Creme Developer', analysis);
    // Apply guard which will replace scenario with N/A
    out = expressTonesGuard(out, analysis, brand);
    // After guard the scenario formula is N/A and should pass validation
    return validateAgainstAllowList(out, brand).valid;
  });
  // Test 15: Wella Koleston Perfect missing developer fails
  addTest('Wella Koleston Perfect missing developer', () => {
    const brand = 'Wella Koleston Perfect';
    const out = buildOut('7/1 (1:1)');
    return !validateAgainstAllowList(out, brand).valid;
  });

  const allPass = tests.every(t => t.pass);
  res.json({ allPass, tests });
});

// ------------------------------- Start Server -------------------------------
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Formula Guru server running on :${PORT}`));
}

export default app;
