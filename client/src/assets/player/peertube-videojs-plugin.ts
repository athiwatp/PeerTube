// Big thanks to: https://github.com/kmoskwiak/videojs-resolution-switcher

import * as videojs from 'video.js'
import * as WebTorrent from 'webtorrent'
import { VideoFile } from '../../../../shared/models/videos/video.model'
import { renderVideo } from './video-renderer'

declare module 'video.js' {
  interface Player {
    peertube (): PeerTubePlugin
  }
}

interface VideoJSComponentInterface {
  _player: videojs.Player

  new (player: videojs.Player, options?: any)

  registerComponent (name: string, obj: any)
}

type PeertubePluginOptions = {
  videoFiles: VideoFile[]
  playerElement: HTMLVideoElement
  peerTubeLink: boolean
}

// https://github.com/danrevah/ngx-pipes/blob/master/src/pipes/math/bytes.ts
// Don't import all Angular stuff, just copy the code with shame
const dictionaryBytes: Array<{max: number, type: string}> = [
  { max: 1024, type: 'B' },
  { max: 1048576, type: 'KB' },
  { max: 1073741824, type: 'MB' },
  { max: 1.0995116e12, type: 'GB' }
]
function bytes (value) {
  const format = dictionaryBytes.find(d => value < d.max) || dictionaryBytes[dictionaryBytes.length - 1]
  const calc = Math.floor(value / (format.max / 1024)).toString()

  return [ calc, format.type ]
}

// videojs typings don't have some method we need
const videojsUntyped = videojs as any
const webtorrent = new WebTorrent({ dht: false })

const MenuItem: VideoJSComponentInterface = videojsUntyped.getComponent('MenuItem')
class ResolutionMenuItem extends MenuItem {

  constructor (player: videojs.Player, options) {
    options.selectable = true
    super(player, options)

    const currentResolution = this.player_.peertube().getCurrentResolution()
    this.selected(this.options_.id === currentResolution)
  }

  handleClick (event) {
    super.handleClick(event)

    this.player_.peertube().updateResolution(this.options_.id)
  }
}
MenuItem.registerComponent('ResolutionMenuItem', ResolutionMenuItem)

const MenuButton: VideoJSComponentInterface = videojsUntyped.getComponent('MenuButton')
class ResolutionMenuButton extends MenuButton {
  label: HTMLElement

  constructor (player: videojs.Player, options) {
    options.label = 'Quality'
    super(player, options)

    this.label = document.createElement('span')

    this.el().setAttribute('aria-label', 'Quality')
    this.controlText('Quality')

    videojsUntyped.dom.addClass(this.label, 'vjs-resolution-button-label')
    this.el().appendChild(this.label)

    player.peertube().on('videoFileUpdate', () => this.update())
  }

  createItems () {
    const menuItems = []
    for (const videoFile of this.player_.peertube().videoFiles) {
      menuItems.push(new ResolutionMenuItem(
        this.player_,
        {
          id: videoFile.resolution,
          label: videoFile.resolutionLabel,
          src: videoFile.magnetUri,
          selected: videoFile.resolution === this.currentSelection
        })
      )
    }

    return menuItems
  }

  update () {
    if (!this.label) return

    this.label.innerHTML = this.player_.peertube().getCurrentResolutionLabel()
    this.hide()
    return super.update()
  }

  buildCSSClass () {
    return super.buildCSSClass() + ' vjs-resolution-button'
  }

  dispose () {
    this.parentNode.removeChild(this)
  }
}
MenuButton.registerComponent('ResolutionMenuButton', ResolutionMenuButton)

const Button: VideoJSComponentInterface = videojsUntyped.getComponent('Button')
class PeertubeLinkButton extends Button {

  createEl () {
    const link = document.createElement('a')
    link.href = window.location.href.replace('embed', 'watch')
    link.innerHTML = 'PeerTube'
    link.title = 'Go to the video page'
    link.className = 'vjs-peertube-link'
    link.target = '_blank'

    return link
  }

  handleClick () {
    this.player_.pause()
  }

  dispose () {
    this.parentNode.removeChild(this)
  }
}
Button.registerComponent('PeerTubeLinkButton', PeertubeLinkButton)

class WebTorrentButton extends Button {
  createEl () {
    const div = document.createElement('div')
    const subDiv = document.createElement('div')
    div.appendChild(subDiv)

    const downloadIcon = document.createElement('span')
    downloadIcon.classList.add('icon', 'icon-download')
    subDiv.appendChild(downloadIcon)

    const downloadSpeedText = document.createElement('span')
    downloadSpeedText.classList.add('download-speed-text')
    const downloadSpeedNumber = document.createElement('span')
    downloadSpeedNumber.classList.add('download-speed-number')
    const downloadSpeedUnit = document.createElement('span')
    downloadSpeedText.appendChild(downloadSpeedNumber)
    downloadSpeedText.appendChild(downloadSpeedUnit)
    subDiv.appendChild(downloadSpeedText)

    const uploadIcon = document.createElement('span')
    uploadIcon.classList.add('icon', 'icon-upload')
    subDiv.appendChild(uploadIcon)

    const uploadSpeedText = document.createElement('span')
    uploadSpeedText.classList.add('upload-speed-text')
    const uploadSpeedNumber = document.createElement('span')
    uploadSpeedNumber.classList.add('upload-speed-number')
    const uploadSpeedUnit = document.createElement('span')
    uploadSpeedText.appendChild(uploadSpeedNumber)
    uploadSpeedText.appendChild(uploadSpeedUnit)
    subDiv.appendChild(uploadSpeedText)

    const peersText = document.createElement('span')
    peersText.textContent = ' peers'
    peersText.classList.add('peers-text')
    const peersNumber = document.createElement('span')
    peersNumber.classList.add('peers-number')
    subDiv.appendChild(peersNumber)
    subDiv.appendChild(peersText)

    div.className = 'vjs-webtorrent'
    // Hide the stats before we get the info
    subDiv.className = 'vjs-webtorrent-hidden'

    this.player_.peertube().on('torrentInfo', (event, data) => {
      const downloadSpeed = bytes(data.downloadSpeed)
      const uploadSpeed = bytes(data.uploadSpeed)
      const numPeers = data.numPeers

      downloadSpeedNumber.textContent = downloadSpeed[0]
      downloadSpeedUnit.textContent = ' ' + downloadSpeed[1]

      uploadSpeedNumber.textContent = uploadSpeed[0]
      uploadSpeedUnit.textContent = ' ' + uploadSpeed[1]

      peersNumber.textContent = numPeers

      subDiv.className = 'vjs-webtorrent-displayed'
    })

    return div
  }

  dispose () {
    this.parentNode.removeChild(this)
  }
}
Button.registerComponent('WebTorrentButton', WebTorrentButton)

const Plugin: VideoJSComponentInterface = videojsUntyped.getPlugin('plugin')
class PeerTubePlugin extends Plugin {
  private player: any
  private currentVideoFile: VideoFile
  private playerElement: HTMLVideoElement
  private videoFiles: VideoFile[]
  private torrent: WebTorrent.Torrent

  constructor (player: videojs.Player, options: PeertubePluginOptions) {
    super(player, options)

    this.videoFiles = options.videoFiles

    // Hack to "simulate" src link in video.js >= 6
    // Without this, we can't play the video after pausing it
    // https://github.com/videojs/video.js/blob/master/src/js/player.js#L1633
    this.player.src = function () {
      return true
    }

    this.playerElement = options.playerElement

    this.player.ready(() => {
      this.initializePlayer(options)
      this.runTorrentInfoScheduler()
    })
  }

  dispose () {
    // Don't need to destroy renderer, video player will be destroyed
    this.flushVideoFile(this.currentVideoFile, false)
  }

  getCurrentResolution () {
    return this.currentVideoFile ? this.currentVideoFile.resolution : -1
  }

  getCurrentResolutionLabel () {
    return this.currentVideoFile ? this.currentVideoFile.resolutionLabel : ''
  }

  updateVideoFile (videoFile?: VideoFile, done?: () => void) {
    if (done === undefined) {
      done = () => { /* empty */ }
    }

    // Pick the first one
    if (videoFile === undefined) {
      videoFile = this.videoFiles[0]
    }

    // Don't add the same video file once again
    if (this.currentVideoFile !== undefined && this.currentVideoFile.magnetUri === videoFile.magnetUri) {
      return
    }

    const previousVideoFile = this.currentVideoFile
    this.currentVideoFile = videoFile

    console.log('Adding ' + videoFile.magnetUri + '.')
    this.torrent = webtorrent.add(videoFile.magnetUri, torrent => {
      console.log('Added ' + videoFile.magnetUri + '.')

      this.flushVideoFile(previousVideoFile)

      const options = { autoplay: true, controls: true }
      renderVideo(torrent.files[0], this.playerElement, options,(err, renderer) => {
        if (err) return this.handleError(err)

        this.renderer = renderer
        if (!this.player.paused()) this.player.play().then(done)
      })
    })

    this.torrent.on('error', err => this.handleError(err))
    this.torrent.on('warning', (err: any) => {
      // We don't support HTTP tracker but we don't care -> we use the web socket tracker
      if (err.message.indexOf('Unsupported tracker protocol') !== -1) return
      // Users don't care about issues with WebRTC, but developers do so log it in the console
      if (err.message.indexOf('Ice connection failed') !== -1) {
        console.error(err)
        return
      }

      return this.handleError(err)
    })

    this.trigger('videoFileUpdate')
  }

  updateResolution (resolution) {
    // Remember player state
    const currentTime = this.player.currentTime()
    const isPaused = this.player.paused()

    // Remove poster to have black background
    this.playerElement.poster = ''

    // Hide bigPlayButton
    if (!isPaused) {
      this.player.bigPlayButton.hide()
    }

    const newVideoFile = this.videoFiles.find(f => f.resolution === resolution)
    this.updateVideoFile(newVideoFile, () => {
      this.player.currentTime(currentTime)
      this.player.handleTechSeeked_()
    })
  }

  flushVideoFile (videoFile: VideoFile, destroyRenderer = true) {
    if (videoFile !== undefined && webtorrent.get(videoFile.magnetUri)) {
      if (destroyRenderer === true) this.renderer.destroy()
      webtorrent.remove(videoFile.magnetUri)
      console.log('Removed ' + videoFile.magnetUri)
    }
  }

  setVideoFiles (files: VideoFile[]) {
    this.videoFiles = files

    this.updateVideoFile(undefined, () => this.player.play())
  }

  private initializePlayer (options: PeertubePluginOptions) {
    const controlBar = this.player.controlBar

    const menuButton = new ResolutionMenuButton(this.player, options)
    const fullscreenElement = controlBar.fullscreenToggle.el()
    controlBar.resolutionSwitcher = controlBar.el().insertBefore(menuButton.el(), fullscreenElement)

    if (options.peerTubeLink === true) {
      const peerTubeLinkButton = new PeertubeLinkButton(this.player)
      controlBar.peerTubeLink = controlBar.el().insertBefore(peerTubeLinkButton.el(), fullscreenElement)
    }

    const webTorrentButton = new WebTorrentButton(this.player)
    controlBar.webTorrent = controlBar.el().insertBefore(webTorrentButton.el(), controlBar.progressControl.el())

    if (this.player.options_.autoplay === true) {
      this.updateVideoFile()
    } else {
      this.player.one('play', () => {
        // On firefox, we need to wait to load the video before playing
        if (navigator.userAgent.toLowerCase().indexOf('firefox') !== -1) {
          this.player.pause()
          this.updateVideoFile(undefined, () => this.player.play())
          return
        }

        this.updateVideoFile(undefined)
      })
    }
  }

  private runTorrentInfoScheduler () {
    setInterval(() => {
      if (this.torrent !== undefined) {
        this.trigger('torrentInfo', {
          downloadSpeed: this.torrent.downloadSpeed,
          numPeers: this.torrent.numPeers,
          uploadSpeed: this.torrent.uploadSpeed
        })
      }
    }, 1000)
  }

  private handleError (err: Error | string) {
    return this.player.trigger('customError', { err })
  }
}
videojsUntyped.registerPlugin('peertube', PeerTubePlugin)
