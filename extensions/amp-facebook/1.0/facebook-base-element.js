/**
 * Copyright 2021 The AMP HTML Authors. All Rights Reserved.
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

import {Facebook} from './component';
import {PreactBaseElement} from '../../../src/preact/base-element';
import {dashToUnderline} from '../../../src/core/types/string';

export class FacebookBaseElement extends PreactBaseElement {}

/** @override */
FacebookBaseElement['Component'] = Facebook;

/** @override */
FacebookBaseElement['props'] = {
  'title': {attr: 'title'}, // Needed for Preact component
  'href': {attr: 'data-href'},
  'locale': {
    attr: 'data-locale',
    default: dashToUnderline(window.navigator.language),
  },
};

/** @override */
FacebookBaseElement['layoutSizeDefined'] = true;

/** @override */
FacebookBaseElement['usesShadowDom'] = true;
