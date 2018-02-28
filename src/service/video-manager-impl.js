/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
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
import {installVideoManagerV2ForDoc} from './video-manager-v2-impl';
import {installVideoManagerV1ForDoc} from './video-manager-v1-impl';
import {once} from '../utils/function';
import {toWin} from '../types';
import {isExperimentOn} from '../experiments';


const TAG = 'video-manager';


/**
 * @typedef {
 *   !../video-manager-v1-impl.VideoManagerV1|
 *   !../video-manager-v2-impl.VideoManagerV2
 * }
 */
export let VideoManager;


const useV2 = once(function(win) {
  return isExperimentOn(win, 'video-manager-v2');
});


/**
 * @param {!Node|!./ampdoc-impl.AmpDoc} nodeOrDoc
 */
export function installVideoManagerForDoc(nodeOrDoc) {
  const win = nodeOrDoc.win || toWin(nodeOrDoc.ownerDocument.defaultView);
  installVideoManagerV2ForDoc(nodeOrDoc);
  // if (useV2(win)) {
    // installVideoManagerV2ForDoc(nodeOrDoc);
    // return;
  // }
  // installVideoManagerV1ForDoc(nodeOrDoc);
}
