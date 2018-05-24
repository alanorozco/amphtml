/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {VideoEvents} from './video-interface';
import {dev} from './log';
import {htmlFor} from './static-template';
import {isArray, isObject} from './types';
import {startsWith} from './string';
import {tryParseJson} from './json';


/**
 * @param {!Event} event
 * @param {?Element} iframe
 * @param {string|!RegExp} host
 * @return {boolean}
 */
export function originMatches(event, iframe, host) {
  if (!iframe || event.source != iframe.contentWindow) {
    return false;
  }
  if (typeof host === 'string') {
    return host == event.origin;
  }
  return host.test(event.origin);
}


/**
 * Re-dispatches an event received from postMessage as an event in the host
 * document.
 *
 * @param {!AmpElement} element
 * @param {string} event
 * @param {!Object<string, (string|?Array<string>)>} events
 * @return {boolean}
 */
export function redispatch(element, event, events) {
  if (events[event] == null) {
    return false;
  }
  const dispatchEvent = events[event];
  (isArray(dispatchEvent) ? dispatchEvent : [dispatchEvent]).forEach(e => {
    element.dispatchCustomEvent(dev().assertString(e));
  });
  return true;
}


/**
 * @param {!./base-element.BaseElement} video
 * @param {string} src
 * @return {!Element}
 */
export function createFrameFor(video, src) {
  const {element} = video;
  const frame =
      htmlFor(element)`<iframe frameborder=0 allowfullscreen></iframe>`;

  frame.src = src;

  video.applyFillContent(frame);
  element.appendChild(frame);

  return frame;
}


/**
 * @param {?} anything
 * @return {boolean}
 */
export function isJsonOrObj(anything) {
  if (!anything) {
    return false;
  }
  return isObject(anything) ||
    startsWith(/** @type {string} */ (anything), '{');
}


/**
 * @param {?JsonObject|string} objOrStr
 * @return {?JsonObject|undefined}
 */
export function objOrParseJson(objOrStr) {
  if (isObject(objOrStr)) {
    return /** @type {!JsonObject} */ (objOrStr);
  }
  return tryParseJson(objOrStr);
}


/**
 * @param {boolean} isMuted
 * @return {string}
 */
export function mutedOrUnmutedEvent(isMuted) {
  return isMuted ? VideoEvents.MUTED : VideoEvents.UNMUTED;
}
