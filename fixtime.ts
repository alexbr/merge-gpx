'use strict'

import _ from 'lodash';
import fs from 'fs';
import { XMLParser, XMLBuilder} from 'fast-xml-parser';

interface ParsedGpx {
  gpx: { trk: { trkseg: { trkpt: TrkPrt[] }}}
}

interface TrkPrt {
  time: string,
  '@_lat': string,
  '@_lon': string,
}

const fileToMerge: string = './lunch-ride_20211211.gpx';
const timeToReach: string = '2021-12-18T20:14:37Z';
const readXml: Buffer = fs.readFileSync(fileToMerge);
const timeToReachMs: number = Date.parse(timeToReach);

const parser: any = new XMLParser({ignoreAttributes: false});
const parsed: ParsedGpx = parser.parse(readXml);
const count: number = parsed.gpx.trk.trkseg.trkpt.length;
const startTimeMs: number = timeToReachMs - (count * 1000);
const trkPrts: TrkPrt[] = parsed.gpx.trk.trkseg.trkpt;
const milePerKm: number = .621371; // mi/km
const secPerHour: number = 3600;

_.forEach(trkPrts, (trkPrt, idx) => {
  const d: Date = new Date(startTimeMs + (idx * 1000));
  trkPrt.time = d.toISOString();
  console.warn(trkPrt.time);
  const lat: number = Number.parseFloat(trkPrt['@_lat']);
  const lng: number = Number.parseFloat(trkPrt['@_lon']);
  //console.warn(`lat, lng: ${lat}, ${lng}`);

  if (idx < trkPrts.length - 1) {
    const nextPrt: TrkPrt = trkPrts[idx + 1];
    const nextLat: number = Number.parseFloat(nextPrt['@_lat']);
    const nextLng: number = Number.parseFloat(nextPrt['@_lon']);
    const dist: number = haversineDist(lat, lng, nextLat, nextLng);
    //const dist1 = linearDist(lat, lng, nextLat, nextLng);
    //console.warn(`next lat, lng: ${nextLat}, ${nextLng}`);
    console.warn(`distance (m): ${dist}`);
    console.warn(`speed (mi/h): ${(dist / 1000) * milePerKm * secPerHour}`)
  }
});

const builder = new XMLBuilder({ignoreAttributes: false, format: true});
const xmlContent = builder.build(parsed);

fs.writeFileSync('./lunch-ride-fixed.gpx', xmlContent);

/**
 * Returns Haversine distance in meters.
*/
function haversineDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // metres
  const φ1 = lat1 * Math.PI/180; // φ, λ in radians
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
    Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // in metres
}

function linearDist(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const decimalToMeters = 1000 * 10000 / 90;
  const decDist = Math.sqrt(
    Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2));

  return decimalToMeters * decDist;
}
