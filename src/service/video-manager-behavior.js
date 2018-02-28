import {Autoplay} from './video-manager-autoplay';
import {VideoAnalytics} from './video-manager-analytics';


/**
 * @const @enum {number}
 */
export const VideoBehaviorId = {
  AUTOPLAY: Math.pow(2, 0),
  ANALYTICS: Math.pow(2, 1),
};


export const VIDEO_BEHAVIORS = [Autoplay, VideoAnalytics];


export const ALL_VIDEO_BEHAVIOR_IDS =
    Object.values(VideoBehaviorId).reduce((a, b) => a | b);


/**
 * @param {number} bitwiseString
 * @param {number} bitwiseId
 */
export function isBehaviorInstalled(bitwiseString, bitwiseId) {
  return (bitwiseString & bitwiseId) > 0;
}


export const VideoObservables = {
  PLAYBACK: 0,
  RESIZE: 1,
  SECONDS_PLAYING: 2,
  VISIBILITY: 3,
  ACTION_SESSION: 4,
  VISIBILITY_SESSION: 5,
};
