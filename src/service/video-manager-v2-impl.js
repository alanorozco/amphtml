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
import {ActionTrust} from '../action-trust';
import {
  ALL_VIDEO_BEHAVIOR_IDS,
  VIDEO_BEHAVIORS,
  VideoBehaviorId,
  VideoObservables,
  isBehaviorInstalled,
} from './video-manager-behavior';
import {ChunkPriority, chunk} from '../chunk';
import {
  EMPTY_METADATA,
  parseFavicon,
  parseOgImage,
  parseSchemaImage,
  setMediaSession,
} from '../mediasession-helper';
import {Observable} from '../observable';
import {
  PlayingStates,
  VideoAttributes,
  VideoEvents,
} from '../video-interface';
import {Services} from '../services';
import {VideoSessionManager} from './video-session-manager';
import {
  listen,
  listenOnce,
} from '../event-helper';
import {dev} from '../log';
import {getData} from '../event-helper';
import {getMode} from '../mode';
import {getServiceForDoc, registerServiceBuilderForDoc} from '../service';
import {isFiniteNumber} from '../types';
import {map} from '../utils/object';
import {once} from '../utils/function';
import {scopedQuerySelector} from '../dom';



/** @private @const {string} */
const TAG = 'video-manager';


/**
 * Property to be set on an element containing a reference to its `VideoEntry`.
 * @private @const {string}
 */
const ENTRY_PROP = '__AMP_VIDEO_ENTRY__';


/** @private @const {string} */
const INTERNAL_ELEMENT = 'video, iframe';


/**
 * Conjunction of behaviors to be installed by default.
 * @private @const {number}
 */
// TODO(alanorozco, #13674): Only install analytics if required.
const DEFAULT_BEHAVIORS = VideoBehaviorId.ANALYTICS;


/**
 * @const {number} Percentage of the video that should be in viewport before it
 * is considered visible.
 */
const VISIBILITY_RATIO = 0.75;

/**
 * @private {number} The minimum number of milliseconds to wait between each
 * video-seconds-played analytics event.
 */
const SECONDS_PLAYED_MIN_DELAY = 1000;

const NOOP = () => {};

const {call} = Function.prototype;


/**
 * Lazy observable that initializes when an observer is added and disposes
 * itself when all observers are removed.
 * @template T
 */
class LazyObservable {
  /**
   * @param {!function(Observable<T>):!UnlistenDef} installListenerFn
   *    Function that receives an observable and determines when to fire.
   *    Returns an unlistener (`UnlistenDef`) that gets called when no more
   *    observers are listening to this broadcast.
   */
  constructor(installListenerFn) {
    /** @private @const {!function(Observable<T>):!UnlistenDef} */
    this.installListenerFn_ = installListenerFn;

    /** @private @const {!Observable T} */
    this.observable_ = new Observable();

    /** @private {!function(Observable<T>):!UnlistenDef} */
    this.installListenerOnce_ = this.createListenerInstaller_();

    /** @private {?UnlistenDef} */
    this.uninstallListener_ = null;
  }

  /**
   * @param {!function(T):*} handler
   * @return {!UnlistenDef}
   */
  observe(handler) {
    const unlisten = this.observable_.add(handler);
    this.installListenerOnce_();
    return () => (unlisten(), this.maybeUninstall_());
  }

  /** @private @return {!function(Observable<T>):!UnlistenDef} */
  createListenerInstaller_() {
    return once(() => {
      this.uninstallListener_ = this.installListenerFn_(this.observable_);
    });
  }

  /** @private */
  maybeUninstall_() {
    if (this.observable_.getHandlerCount() > 0) {
      return;
    }
    const uninstall =
        dev().assert(this.uninstallListener_, 'No uninstaller set.')

    // Reset installer so that it gets reapplied when the next observer
    // is added.
    this.installListenerOnce_ = this.createListenerInstaller_();
    this.uninstallListener_ = null;

    uninstall();
  }
}


/**
 * VideoManager keeps track of all AMP video players that implement
 * the common Video API {@see ../video-interface.VideoInterface}.
 *
 * It is responsible for providing a unified user experience and analytics for
 * all videos within a document.
 */
export class VideoManagerV2 {

  /**
   * @param {!./ampdoc-impl.AmpDoc} ampdoc
   */
  constructor(ampdoc) {

    /** @const {!./ampdoc-impl.AmpDoc}  */
    this.ampdoc = ampdoc;

    /** @private {!../service/viewport/viewport-impl.Viewport} */
    this.viewport_ = Services.viewportForDoc(this.ampdoc);

    /** @private {?Array<!VideoEntry>} */
    this.entries_ = null;

    /** @public @const {!LazyObservable<void>} */
    this.scroll = new LazyObservable(this.installScrollListener_.bind(this));

    /** @public @const {!LazyObservable<void>} */
    this.resize = new LazyObservable(this.installResize_.bind(this));

    /** @public @const {!LazyObservable<void>} */
    this.secondsPlaying =
        new LazyObservable(this.installSecondsPlaying_.bind(this));
  }

  /**
   * Registers a video component that implements the VideoInterface.
   * @param {!../video-interface.VideoInterface} video
   * @param {boolean=} unusedFromV1ManageAutoplay
   */
  register(video, unusedFromV1ManageAutoplay) {
    dev().assert(video);

    const {element} = video;

    this.registerCommonActions_(video);

    if (!video.supportsPlatform()) {
      return;
    }

    if (this.getEntryForElement_(element)) {
      return;
    }

    element[ENTRY_PROP] = new VideoEntry(this, video);
  }

  unregister(video) {
    const {element} = video;
    if (!(ENTRY_PROP in element)) {
      return;
    }
    const entry = dev().assert(this.getEntryForElement_(element));
    entry.uninstall();
    element[ENTRY_PROP] = null; // GC
    return;
  }

  /**
   * @param {!Observable}
   * @return {!UnlistenDef}
   * @private
   */
  installSecondsPlaying_(observable) {
    const {win} = this.ampdoc;
    const timer = Services.timerFor(ampdoc.win);
    const id = timer.delay(() => observable.fire(), SECONDS_PLAYED_MIN_DELAY);
    return () => timer.cancel(id);
  }

  /**
   * @param {!Observable}
   * @return {!UnlistenDef}
   * @private
   */
  installResize_(observable) {
    return this.viewport_.onResize(() => observable.fire());
  }

  /**
   * @param {!Observable} observable
   * @return {!UnlistenDef}
   */
  installScrollListener_(observable) {
    // TODO(aghassemi, #6425): Use IntersectionObserver
    const handler = () => observable.fire();
    const unlisteners = [
      this.viewport_.onScroll(handler),
      this.viewport_.onChanged(handler),
    ];
    return () => unlisteners.forEach(call);
  }

  /**
   * Register common actions such as play, pause, etc... on the video element
   * so they can be called using AMP Actions.
   * For example: <button on="tap:myVideo.play">
   *
   * @param {!../video-interface.VideoInterface} video
   * @private
   */
  registerCommonActions_(video) {
    // Only require ActionTrust.LOW for video actions to defer to platform
    // specific handling (e.g. user gesture requirement for unmuted playback).
    const trust = ActionTrust.LOW;

    video.registerAction('play', () => video.play(/* isAuto */ false), trust);
    video.registerAction('pause', () => video.pause(), trust);
    video.registerAction('mute', () => video.mute(), trust);
    video.registerAction('unmute', () => video.unmute(), trust);
    video.registerAction('fullscreen', () => video.fullscreenEnter(), trust);
  }

  /**
   * @param {!AmpElement} element
   * @return {?VideoEntry} entry
   * @private
   */
  getEntryForElement_(element) {
    return element[ENTRY_PROP] || null;
  }

  /**
   * @param {!AmpElement} element
   * @param {number} mask
   */
  remaskBehaviors(element, mask) {
    const entry = this.getEntryForElement_(element);
    if (!entry) {
      // Set attribute in case video has not been registered.
      element.setAttribute('i-amphtml-behaviors', mask.toString(2));
      return;
    }
    entry.remaskBehaviors(mask);
  }
}


/**
 * VideoEntry represents an entry in the VideoManager's list.
 */
class VideoEntry {
  /**
   * @param {!VideoManager} manager
   * @param {!../video-interface.VideoInterface} video
   */
  constructor(manager, video) {
    const element = dev().assert(video.element);

    /** @private @const {!./ampdoc-impl.AmpDoc}  */
    this.ampdoc_ = manager.ampdoc;

    this.manager_ = manager;

    /** @package @const {!../video-interface.VideoInterface} */
    this.video = video;

    /** @private {boolean} */
    this.isLoaded_ = false;

    /** @private {boolean} */
    this.isPlaying_ = false;

    /** @private {boolean} */
    this.isVisible_ = false;

    /**
     * Overridden once a behavior subscribes to `visibility`.
     * @private {!function()}
     */
    this.onLoadedVisibilityChanged_ = NOOP;

    this.scroll_ = manager.scroll;

    this.resize_ = manager.resize;

    /** @private @const {!LazyObservable<!VideoEvents>} */
    this.playback_ =
        new LazyObservable(o => this.installPlaybackListeners_(o));

    /** @private @const {!LazyObservable<boolean>} */
    this.visibility_ =
        new LazyObservable(o => this.installVisibilityObserver_(o));

    /** @private @const {!LazyObservable<void>} */
    this.secondsPlaying_ =
        new LazyObservable(o => this.installSecondsPlaying_(o));

    /** @private @const {!../service/vsync-impl.Vsync} */
    this.vsync_ = Services.vsyncFor(this.ampdoc_.win);

    /** @private @const */
    this.actionSession_ = new VideoSessionManager();

    /** @private @const */
    this.visibilitySession_ = new VideoSessionManager();

    /** @private @const {!Array<!VisibilityDependency>} */
    this.visibilityDependencies_ = [];

    /**
     * VideoEntry-level unlisteners.
     * @private @const {!Array<!UnlistenDef>}
     */
    this.unlisteners_ = [];

    /**
     * Behavior uninstallers.
     * @private @const {!Array<!UnlistenDef>}
     */
    this.uninstallers_ = Array(Object.values(VideoBehaviorId).length).fill(undefined);

    /** @private {!../mediasession-helper.MetadataDef} */
    this.metadata_ = EMPTY_METADATA;

    // Currently we only register after video player is build.
    this.videoBuilt_();
  }

  /**
   * Installs behaviors.
   * @param {number} initial Conjunction of behaviors to be installed initially.
   * @private
   */
  installBehaviors_(initial = 0) {
    const installed = this.behaviorsFromAttrs_(initial);

    Object.values(VideoBehaviorId).forEach((bitwiseId, index) => {
      if (isBehaviorInstalled(installed, bitwiseId)) {
        this.installBehavior_(bitwiseId, VIDEO_BEHAVIORS[index]);
      }
    });
  }

  /**
   * @param {!Observable<void>} observable
   * @private
   */
  installSecondsPlaying_(observable) {
    this.manager_.secondsPlaying.observe(() => {
      if (this.getPlayingState() == PlayingStates.PAUSED) {
        return;
      }
      observable.fire();
    });
  }

  /**
   * Installs a behavior.
   * @param {number} bitwiseId
   * @private
   */
  installBehavior_(bitwiseId) {
    const ampdoc = this.ampdoc_;
    const {win} = ampdoc;
    const {element} = this.video;
    const index = Math.log2(bitwiseId);
    const ctor = VIDEO_BEHAVIORS[index];
    const behavior = new ctor(win, ampdoc, this);

    // Inject dependencies. Sorry.
    const observables = ctor.observables.map(observable => {
      switch(observable) {
        case VideoObservables.RESIZE: return this.resize_;
        case VideoObservables.SECONDS_PLAYING: return this.secondsPlaying_;
        case VideoObservables.PLAYBACK: return this.playback_;
        case VideoObservables.VISIBILITY: return this.visibility_;
        case VideoObservables.ACTION_SESSION: return this.actionSession_;
        case VideoObservables.VISIBILITY_SESSION: return this.visibilitySession_;
      }
      return dev().error();
    });

    const unlisteners = [
      behavior.install.apply(behavior, observables),
      behavior.visibilityWaitsFor ?
        this.installVisibilityDependency_(behavior) :
        NOOP,
    ];

    this.installed |= bitwiseId;

    this.uninstallers_[index] = () => unlisteners.forEach(call);
  }

  setMediaSession_() {
    if (this.video.preimplementsMediaSessionAPI()) {
      return;
    }

    const play = () => this.video.play(/* isAutoplay */ false);
    const pause = () => this.video.pause();

    setMediaSession(this.ampdoc_.win, this.metadata_, play, pause);
  }

  /**
   * @param {!VideoBehavior} behavior
   * return {!UnlistenDef}
   */
  installVisibilityDependency_(behavior) {
    dev().assert(behavior.visibilityWaitsFor);

    const dependency = /** {!VideoVisibilityDependency} */ (behavior);

    this.visibilityDependencies_.push(dependency);

    return () => {
      const index = this.visibilityDependencies_.indexOf(dependency);
      if (index > -1) {
        this.visibilityDependencies_.splice(index, 1);
      }
    };
  }

  /**
   * Uninstalls a behavior.
   * @param {number} bitwiseId
   * @private
   */
  uninstallBehavior_(bitwiseId) {
    const {element} = this.video_;
    const index = Math.log2(bitwiseId);
    const uninstaller = this.uninstallers_[index];

    if (!uninstaller) {
      // warn?
      return;
    }

    this.uninstallers_[index] = null; // GC

    dev().assert(uninstaller).call();
  }

  /** Uninstalls all behaviors. */
  uninstall() {
    // Chunk to prevent blocking UI.
    chunk(this.ampdoc_, () => {
      this.unlisteners_.forEach(call);

      // Some uninstallers may be undefined.
      this.uninstallers_.forEach(u => u && u());
    }, ChunkPriority.LOW);
  }

  /**
   * @param {number} initial
   * @return {number}
   */
  behaviorsFromAttrs_(initial) {
    const {element} = this.video;

    const autoplay = !element.hasAttribute(VideoAttributes.AUTOPLAY) ? 0 :
      VideoBehaviorId.AUTOPLAY;

    // `i-amphtml-behaviors` is set by VideoManager when a video's behavior list
    // is remasked, but has not yet been registered. Parse it to remask before
    // installing. Otherwise, allow all behaviors.
    const mask = element.hasAttribute('i-amphtml-behaviors') ?
        parseInt(element.getAttribute('i-amphtml-behaviors', 2)) :
        ALL_VIDEO_BEHAVIOR_IDS;

    return (initial | autoplay) & mask;
  }

  /**
   * Remasks behavior conjunction to install or uninstall behaviors.
   * @param {number} mask
   */
  // TODO(alanorozco): Favor enable/disable APIs
  remaskBehaviors(mask) {
    const wereInstalled = this.installed_;

    if (mask == wereInstalled) {
      return;
    }

    this.installed_ &= mask;

    Object.entries(VideoBehaviorId).forEach((bitwiseId, index) => {
      const isInstalled = isBehaviorInstalled(mask, bitwiseId);
      const wasIntalled = isBehaviorInstalled(wereInstalled, bitwiseId);
      if (isInstalled === wasInstalled) {
        return;
      }
      if (!isInstalled) {
        this.uninstallBehavior_(bitwiseId);
      } else {
        this.installBehavior_(bitwiseId);
      }
    });
  }

  /**
   * @param {!Observable<boolean>} observable
   * @return {!UnlistenDef}
   * @private
   */
  installVisibilityObserver_(observable) {
    const {element} = this.video;

    const updateVisibility = () => this.updateVisibility_();
    const callback = this.videoVisibilityChanged_.bind(this, observable);

    this.onLoadedVisibilityChanged_ = callback;

    element.whenBuilt().then(updateVisibility);

    const unlisteners = [
      listen(element, VideoEvents.VISIBILITY, details => {
        const data = getData(details);
        if (data && data['visible'] == true) {
          this.updateVisibility_(/* forceVisible */ true);
          return;
        }
        this.updateVisibility_();
      }),
      // TODO(aghassemi, #6425): Use IntersectionObserver
      this.scroll_.observe(updateVisibility),
    ];

    return () => {
      unlisteners.forEach(call);
      this.onLoadedVisibilityChanged_ = NOOP;
    };
  }

  /**
   * @param {!Observable<!VideoEvents>} observable
   * @return {!UnlistenDef}
   * @private
   */
  installPlaybackListeners_(observable) {
    const {element} = this.video;

    const unlisteners = [
      VideoEvents.PAUSE,
      VideoEvents.PLAYING,
      VideoEvents.MUTED,
      VideoEvents.UNMUTED,
      VideoEvents.ENDED,
    ].map(event => listen(element, event, () => observable.fire(event)));

    return () => unlisteners.forEach(call);
  }

  /**
   * Called when the video element is built.
   * @private
   */
  videoBuilt_() {
    const {element} = this.video;

    this.unlisteners_.push(
      listenOnce(element, VideoEvents.LOAD, () => this.videoLoaded_()),
      listen(element, VideoEvents.PAUSE, () => {
        this.isPlaying_ = false;
      }),
      listen(element, VideoEvents.PLAYING, () => {
        this.isPlaying_ = true;
        this.setMediaSession_();
      }));

    // TODO(alanorozco): listen once reload after what happens?
    // listenOnce(element, VideoEvents.RELOAD, () => this.videoLoaded_());

    this.installBehaviors_(DEFAULT_BEHAVIORS);
  }

  /** @private */
  videoLoaded_() {
    const {element} = this.video;

    this.isLoaded_ = true;

    this.fillMediaSessionMetadata_();
    this.updateVisibility_();

    if (this.isVisible_) {
      this.onLoadedVisibilityChanged_();
    }
  }

  /**
   * Gets the provided metadata and fills in missing fields
   * @private
   */
  fillMediaSessionMetadata_() {
    if (this.video.preimplementsMediaSessionAPI()) {
      return;
    }

    if (this.video.getMetadata()) {
      const metadata = /** @type {!../mediasession-helper.MetadataDef} */ (
        this.video.getMetadata());
      this.metadata_ = map(metadata);
    }

    const {artwork, title} = this.metadata_;
    const docOrShadowRoot = this.ampdoc_.getRootNode();

    if (!title) {
      const title = this.getTitleFromAttribute_() || docOrShadowRoot.title;
      if (title) {
        this.metadata_.title = title;
      }
    }

    if (docOrShadowRoot.nodeType != /* DOCUMENT_NODE */ 9) {
      return;
    }

    const doc = /** @type {!Document} */ (docOrShadowRoot);

    if (!artwork || artwork.length == 0) {
      const posterUrl =
        parseSchemaImage(doc) || parseOgImage(doc) || parseFavicon(doc);

      if (posterUrl) {
        this.metadata_.artwork = [{'src': posterUrl,}];
      }
    }
  }

  /** @private @return {string|undefined} */
  getTitleFromAttribute_() {
    const {element} = this.video;
    const internalElement = scopedQuerySelector(element, INTERNAL_ELEMENT);
    return element.getAttribute('title') ||
      element.getAttribute('aria-label') ||
      internalElement.getAttribute('title') ||
      internalElement.getAttribute('aria-label');
  }

  /**
   * Handles the visibility of a loaded video changing.
   * @private
   */
  videoVisibilityChanged_(visibilityObservable) {
    const viewer = Services.viewerForDoc(this.ampdoc_);

    if (!viewer.isVisible()) {
      return;
    }

    const dependencies = this.visibilityDependencies_;
    const dependenciesMet = dependencies.map(d => d && d.visibilityWaitsFor());

    Promise.all(dependenciesMet).then(() => {
      if (this.isVisible_) {
        this.visibilitySession_.beginSession();
        visibilityObservable.fire(true);
        return;
      }
      if (this.isPlaying_) {
        this.visibilitySession_.endSession();
        visibilityObservable.fire(false);
      }
    });
  }

  /**
   * Called by all possible events that might change the visibility of the video
   * such as scrolling or {@link ../video-interface.VideoEvents#VISIBILITY}.
   * @param {?boolean=} forceVisible
   * @private
   */
  updateVisibility_(forceVisible = false) {
    const wasVisible = this.isVisible_;

    this.vsync_.run({
      measure: () => {
        if (forceVisible) {
          this.isVisible_ = true;
          return;
        }
        const {element} = this.video;
        const {intersectionRatio} = element.getIntersectionChangeEntry();
        const ratio =
            !isFiniteNumber(intersectionRatio) ? intersectionRatio : 0;
        this.isVisible_ = ratio >= VISIBILITY_RATIO;
      },
      mutate: () => {
        if (this.isVisible_ == wasVisible) {
          return;
        }
        if (this.isLoaded_) {
          this.onLoadedVisibilityChanged_();
        }
      },
    });
  }

  /**
   * Returns whether the video is paused or playing after the user interacted
   * with it or playing through autoplay
   * @return {!../video-interface.VideoInterface} PlayingStates
   */
  getPlayingState() {
    if (!this.isPlaying_) {
      return PlayingStates.PAUSED;
    }

    // if (this.isPlaying_playCalledByAutoplay_
    //    && this.
    //    && !this.userInteractedWithAutoPlay_) {
    //   // NOTE(alanorozco): Hm.
    //   return PlayingStates.PLAYING_AUTO;
    // }

    return PlayingStates.PLAYING_MANUAL;
  }
}


/**
 * @param {!Node|!./ampdoc-impl.AmpDoc} nodeOrDoc
 */
export function installVideoManagerV2ForDoc(nodeOrDoc) {
  registerServiceBuilderForDoc(nodeOrDoc, 'video-manager', VideoManagerV2);
}
