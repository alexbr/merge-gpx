"use strict";

import fs from "fs";
import readline from "readline";
import _ from "lodash";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

/**
 * Types
 */
interface Arguments {
  [x: string]: unknown;
  beginGpx: string;
  endGpx: string;
  outputGpx: string;
  mergeThresholdMeters: number;
}

interface ParsedGpx {
  gpx: { trk: { trkseg: { trkpt: TrkPrt[] } } };
}

interface TrkPrt {
  time: string;
  ele: number;
  "@_lat": string;
  "@_lon": string;
}

function trkPrtToString(trkPrt: TrkPrt, printTime: boolean = true): string {
  let str = ``;
  if (printTime) {
    str = `  time: ${trkPrt.time}}\n`;
  }

  str += `  ele: ${trkPrt.ele}
  lat: ${trkPrt["@_lat"]}
  lng: ${trkPrt["@_lon"]}`;

  return str;
}

interface XmlData {
  beginXml: ParsedGpx;
  endXml: ParsedGpx;
}

/** Class represening latitude and longitude. */
class LatLng {
  lat: number;
  lng: number;

  constructor(lat: string, lng: string) {
    this.lat = Number.parseFloat(lat);
    this.lng = Number.parseFloat(lng);
  }

  /** Convenience factory constructor. */
  static fromTrkPrt(trkPrt: TrkPrt): LatLng {
    return new LatLng(trkPrt["@_lat"], trkPrt["@_lon"]);
  }

  /**
   * Determines if this LatLng's latitude or longitude is beween the given
   * LatLngs' latitudes or longitudes.
   */
  isBetween(latLng1: LatLng, latLng2: LatLng): boolean {
    if (
      (latLng1.lat <= this.lat && this.lat <= latLng2.lat) ||
      (latLng2.lat <= this.lat && this.lat <= latLng1.lat) ||
      (latLng1.lng <= this.lng && this.lng <= latLng2.lng) ||
      (latLng2.lng <= this.lng && this.lng <= latLng1.lng)
    ) {
      return true;
    }

    return false;
  }
}

/**
 * Functions
 */
function loadFiles(beginGpx: string, endGpx: string): XmlData {
  const parser: any = new XMLParser({ ignoreAttributes: false });
  const endFile: Buffer = fs.readFileSync(endGpx);
  const beginningFile: Buffer = fs.readFileSync(beginGpx);

  const beginningXml: ParsedGpx = parser.parse(beginningFile);
  const endXml: ParsedGpx = parser.parse(endFile);

  return {
    beginXml: beginningXml,
    endXml: endXml,
  };
}

async function findMergePoint(
  beginXml: ParsedGpx,
  endXml: ParsedGpx,
  outputGpx: string,
  thresholdMeters: number
): Promise<void> {
  const beginTrkPrts: TrkPrt[] = beginXml.gpx.trk.trkseg.trkpt;
  const endTrkPrts: TrkPrt[] = endXml.gpx.trk.trkseg.trkpt;
  const firstTrkInEnd: TrkPrt = endTrkPrts[0];
  const firstEndLatLng: LatLng = LatLng.fromTrkPrt(firstTrkInEnd);

  console.info(`Point to merge with:`);
  console.info(trkPrtToString(firstTrkInEnd));

  let minDist: number = Number.POSITIVE_INFINITY;
  let toMerge: TrkPrt[] = [];

  for (let index = 0; index < beginTrkPrts.length; index++) {
    const trkPrt = beginTrkPrts[index];
    toMerge.push(trkPrt);

    const latLng: LatLng = LatLng.fromTrkPrt(trkPrt);
    const dist: number = haversineDist(firstEndLatLng, latLng);

    if (dist <= thresholdMeters) {
      let isMinDist = false;
      if (dist <= minDist) {
        minDist = dist;
        isMinDist = true;
      }

      console.info("");
      console.info(`This point looks promising:`);
      console.info(trkPrtToString(trkPrt, false));

      let inBetween = false;

      if (index < beginTrkPrts.length - 1) {
        const nextPrt = beginTrkPrts[index + 1];
        inBetween = firstEndLatLng.isBetween(
          latLng,
          LatLng.fromTrkPrt(nextPrt)
        );
        console.info(`Next trkPrt:`);
        console.info(trkPrtToString(nextPrt, false));
      }

      console.info(`Distance from merge point: ${minDist}m`);
      console.info(
        `The merge point ${firstEndLatLng.lat}, ${
          firstEndLatLng.lng
        }, elevation ${firstTrkInEnd.ele} ${
          inBetween ? "_is_" : "_is not_"
        } between this point and the next.`
      );
      console.info(
        `This point ${
          isMinDist ? "_is_" : "_is not_"
        } the minimum distance from the merge point so far.`
      );

      if (await userConfirm()) {
        await mergeFiles(endXml, toMerge, outputGpx);
        return;
      }
    }
  }

  console.info("No merge point found, try increasing thresholdMeters.");
}

async function mergeFiles(
  endXml: ParsedGpx,
  toMerge: TrkPrt[],
  outputGpx: string
): Promise<void> {
  console.info(`merging GPX data to ${outputGpx}...`);
  const endTrkPrts: TrkPrt[] = endXml.gpx.trk.trkseg.trkpt;
  const firstTrkInEnd: TrkPrt = endTrkPrts[0];
  const timeToReachMs: number = Date.parse(firstTrkInEnd.time);
  const startTimeMs: number = timeToReachMs - toMerge.length * 1000;

  _.forEach(toMerge, (trkPrt, index) => {
    const d: Date = new Date(startTimeMs + index * 1000);
    trkPrt.time = d.toISOString();
  });

  endXml.gpx.trk.trkseg.trkpt = toMerge.concat(endTrkPrts);

  const builder = new XMLBuilder({ ignoreAttributes: false, format: true });
  const mergedXml = builder.build(endXml);

  fs.writeFileSync(outputGpx, mergedXml);
  console.info(`merged output written to ${outputGpx}`);
}

function userConfirm(): Promise<boolean> {
  const rl: readline.Interface = readline.createInterface(
    process.stdin,
    process.stdout
  );
  return new Promise((resolve) => {
    rl.question("\nMerge at this point [y|n]? ", async (answer: string) => {
      rl.close();

      if (answer.toLowerCase().match("(y|yes)")) {
        return resolve(true);
      }
      return resolve(false);
    });
  });
}

/**
 * Returns Haversine distance in meters.
 */
export function haversineDist(latLng1: LatLng, latLng2: LatLng): number {
  const R = 6371e3; // meters
  const φ1 = (latLng1.lat * Math.PI) / 180; // φ, λ in radians
  const φ2 = (latLng2.lat * Math.PI) / 180;
  const Δφ = ((latLng2.lat - latLng1.lat) * Math.PI) / 180;
  const Δλ = ((latLng2.lng - latLng1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

export function linearDist(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const decimalToMeters = (1000 * 10000) / 90;
  const decDist = Math.sqrt(
    Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2)
  );

  return decimalToMeters * decDist;
}

/**
 * Script
 */
const args: Arguments = yargs(hideBin(process.argv))
  .option("beginGpx", {
    alias: "b",
    type: "string",
    description: "The GPX file containing the beginninf of the recorded data",
  })
  .option("endGpx", {
    alias: "e",
    type: "string",
    description: "The GPX file containing the end of the recorded data",
  })
  .option("mergeThresholdMeters", {
    alias: "t",
    type: "number",
    description:
      "The maximum distance in meters between two points for them to be considered for a merge",
    default: 10,
  })
  .option("outputGpx", {
    alias: "o",
    type: "string",
    description: "The file to output the merged GPX file",
    default: "merged.gpx",
  })
  .demandOption(
    ["beginGpx", "endGpx"],
    "Please provide both `beginGpx` and `endGpx` files."
  )
  .help()
  .parseSync();

const { beginXml, endXml } = loadFiles(args.beginGpx, args.endGpx);
findMergePoint(beginXml, endXml, args.outputGpx, args.mergeThresholdMeters);
