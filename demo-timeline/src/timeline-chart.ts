import Chart from 'chart.js';
import 'chartjs-plugin-zoom';
import { applyChartInstanceOverrides } from './chartjs-horizontal-bar';
import { Level, LevelParsed } from '../../src/types/level';
import { MediaPlaylist } from '../../src/types/media-playlist';
import { TrackSet } from '../../src/types/track';
import LevelDetails from '../../src/loader/level-details';
import { FragChangedData } from '../../src/types/events';
import Fragment from '../../src/loader/fragment';

export class TimelineChart {
  private chart: Chart;
  private rafDebounceRequestId: number = -1;
  private imageDataBuffer: ImageData | null = null;

  constructor (canvas: HTMLCanvasElement, chartJsOptions?: any) {
    const ctx = canvas.getContext('2d');
    const chart = this.chart = self.chart = new Chart(ctx, {
      type: 'horizontalBar',
      data: {
        labels: [],
        datasets: []
      },
      options: Object.assign(getChartOptions(), chartJsOptions),
      plugins: [{
        afterRender: () => {
          if (self.hls?.media?.ontimeupdate) {
            this.imageDataBuffer = null;
            self.hls.media.ontimeupdate(null);
          }
        }
      }]
    });

    applyChartInstanceOverrides(chart);

    // Log object on click and seek to position
    canvas.onclick = (event: MouseEvent) => {
      const element = chart.getElementAtEvent(event);
      if (element.length) {
        const dataset = chart.data.datasets[element[0]._datasetIndex];
        const obj = dataset.data[element[0]._index];
        console.log(obj);
        if (self.hls?.media) {
          const scale = chart.scales['x-axis-0'];
          const pos = Chart.helpers.getRelativePosition(event, chart);
          const time = scale.getValueForPixel(pos.x);
          self.hls.media.currentTime = time;
        }
      }
    };

    canvas.ondblclick = (event: MouseEvent) => {
      const chartArea: { left, top, right, bottom } = chart.chartArea;
      const element = chart.getElementAtEvent(event);
      const pos = Chart.helpers.getRelativePosition(event, chart);
      const scale = chart.scales['x-axis-0'];
      const range = scale.max - scale.min;
      const newDiff = range * (event.getModifierState('Shift') ? -1.0 : 0.5);
      const minPercent = (scale.getValueForPixel(pos.x) - scale.min) / range;
      const maxPercent = 1 - minPercent;
      const minDelta = newDiff * minPercent;
      const maxDelta = newDiff * maxPercent;
      // zoom in when double clicking near elements in chart area
      if (element.length || pos.x > chartArea.left) {
        scale.options.ticks.min = Math.max(this.minZoom, scale.min + minDelta);
        scale.options.ticks.max = Math.min(this.maxZoom, scale.max - maxDelta);
      } else {
        // chart.resetZoom();
        scale.options.ticks.min = this.minZoom;
        scale.options.ticks.max = this.maxZoom;
      }
      this.update();
    };

    // TODO: Prevent zoom over y axis labels
  }

  reset () {
    const { labels, datasets } = this.chart.data;
    this.maxZoom = 60;
    labels.length = 0;
    datasets.length = 0;
    this.resize(datasets);
  }

  update () {
    this.chart.update({
      duration: 0,
      lazy: true
    });
  }

  resize (datasets?) {
    if (datasets?.length) {
      this.chart.canvas.parentNode.style.height = `${datasets.length * 35}px`;
    }
    self.cancelAnimationFrame(this.rafDebounceRequestId);
    this.rafDebounceRequestId = self.requestAnimationFrame(() => {
      this.chart.resize();
    });
  }

  updateLevels (levels: LevelParsed[] | Level[]) {
    const { labels, datasets } = this.chart.data;
    levels.forEach((level, i) => {
      labels.push(getLevelName(level, level.level || level.id || i));
      datasets.push({
        data: [],
        categoryPercentage: 1,
        url: level.url,
        trackType: 'level',
        level: level.level
      });
      if (level.details) {
        this.updateLevelOrTrack(level.details);
      }
    });
    this.resize(datasets);
  }

  updateAudioTracks (audioTracks: MediaPlaylist[]) {
    const { labels, datasets } = this.chart.data;
    audioTracks.forEach((track, i) => {
      labels.push(getAudioTrackName(track, i));
      datasets.push({
        data: [],
        categoryPercentage: 1,
        url: track.url,
        trackType: 'audioTrack',
        audioTrack: i
      });
      if (track.details) {
        this.updateLevelOrTrack(track.details);
      }
    });
    this.resize(datasets);
  }

  updateSubtitleTracks (subtitles: MediaPlaylist[]) {
    const { labels, datasets } = this.chart.data;
    subtitles.forEach((track, i) => {
      labels.push(getSubtitlesName(track, i));
      datasets.push({
        data: [],
        categoryPercentage: 1,
        url: track.url,
        trackType: 'subtitleTrack',
        subtitleTrack: i
      });
      if (track.details) {
        this.updateLevelOrTrack(track.details);
      }
    });
    this.resize(datasets);
  }

  removeType (trackType: 'level' | 'audioTrack' | 'subtitleTrack') {
    const { labels, datasets } = this.chart.data;
    let i = datasets.length;
    while (i--) {
      if (datasets[i].trackType === trackType) {
        datasets.splice(i, 1);
        labels.splice(i, 1);
      }
    }
  }

  updateLevelOrTrack (details: LevelDetails) {
    const { totalduration, url } = details;
    const { datasets } = this.chart.data;
    // eslint-disable-next-line no-restricted-properties
    const { data } = datasets.find(dataset => dataset.url === url);
    data.length = 0;
    details.fragments.forEach((fragment) => {
      // TODO: keep track of initial playlist start and duration so that we can show drift and pts offset
      // (Make that a feature of hls.js v1.0.0 fragments)
      data.push(Object.assign({}, fragment));
    });
    this.maxZoom = Math.max(totalduration, this.maxZoom);
    this.rafDebounceRequestId = self.requestAnimationFrame(() => this.update());
  }

  get minZoom (): number {
    if (this.chart.config?.options?.plugins?.zoom?.zoom?.rangeMin) {
      return this.chart.config.options.plugins.zoom.zoom.rangeMin.x;
    }
    return 60;
  }

  get maxZoom (): number {
    if (this.chart.config?.options?.plugins?.zoom?.zoom?.rangeMax) {
      return this.chart.config.options.plugins.zoom.zoom.rangeMax.x;
    }
    return 60;
  }

  set maxZoom (x: number) {
    if (this.chart.config?.options?.plugins?.zoom?.zoom?.rangeMax) {
      this.chart.config.options.plugins.zoom.zoom.rangeMax.x = Math.max(x,
        this.chart.config.options.plugins.zoom.zoom.rangeMax.x);
    }
  }

  updateFragment (data: FragChangedData) {
    const { datasets } = this.chart.data;
    const frag: Fragment = data.frag;
    // eslint-disable-next-line no-restricted-properties
    const levelDataSet = datasets.find(dataset => dataset.url === frag.baseurl);
    // eslint-disable-next-line no-restricted-properties
    const fragData = levelDataSet.data.find(fragData => fragData.relurl === frag.relurl);
    if (fragData !== frag) {
      Object.assign(fragData, frag);
    }
    this.rafDebounceRequestId = self.requestAnimationFrame(() => this.update());
  }

  updateSourceBuffers (tracks: TrackSet, media: HTMLMediaElement) {
    const { labels, datasets } = this.chart.data;
    const trackTypes = Object.keys(tracks).sort((type) => type === 'video' ? 1 : -1);
    const mediaBufferData = [];

    trackTypes.forEach((type) => {
      const track = tracks[type];
      const data = [];
      const sourceBuffer = track.buffer;
      const backgroundColor = {
        video: 'rgba(0, 0, 255, 0.2)',
        audio: 'rgba(128, 128, 0, 0.2)',
        audiovideo: 'rgba(128, 128, 255, 0.2)'
      }[type];
      labels.unshift(`${type} buffer (${track.id})`);
      datasets.unshift({
        data,
        categoryPercentage: 0.5,
        backgroundColor,
        sourceBuffer
      });
      sourceBuffer.onupdate = () => {
        try {
          replaceTimeRangeTuples(sourceBuffer.buffered, data);
        } catch (error) {
          console.warn(error);
          return;
        }
        replaceTimeRangeTuples(media.buffered, mediaBufferData);
        this.update();
      };
    });

    labels.unshift('media buffer');
    datasets.unshift({
      data: mediaBufferData,
      categoryPercentage: 0.5,
      backgroundColor: 'rgba(0, 255, 0, 0.2)',
      media
    });

    media.ontimeupdate = () => {
      const chart = this.chart;
      const scale = chart.scales['x-axis-0'];
      const ctx: CanvasRenderingContext2D = chart.ctx;
      const chartArea: { left, top, right, bottom } = chart.chartArea;
      const x = scale.getPixelForValue(media.currentTime);
      this.drawLineX(ctx, x, chartArea);
    };
    this.resize(datasets);
  }

  drawLineX (ctx, x, chartArea) {
    if (!this.imageDataBuffer) {
      const devicePixelRatio = self.devicePixelRatio || 1;
      this.imageDataBuffer = ctx.getImageData(0, 0, chartArea.right * devicePixelRatio, chartArea.bottom * devicePixelRatio);
    } else {
      ctx.restore();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, chartArea.right, chartArea.bottom);
      ctx.putImageData(this.imageDataBuffer, 0, 0);
    }
    if (x > chartArea.left && x < chartArea.right) {
      ctx.restore();
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.5)';
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function getLevelName (level: LevelParsed, index: number) {
  let label = '(main playlist)';
  if (level.attrs.BANDWIDTH) {
    label = `${getMainLevelAttribute(level)}@${level.attrs.BANDWIDTH}`;
    if (level.name) {
      label = `${label} (${level.name})`;
    }
  } else if (level.name) {
    label = level.name;
  }
  return `${label} L-${index}`;
}

function getMainLevelAttribute (level: LevelParsed) {
  return level.attrs.RESOLUTION || level.attrs.CODECS || level.attrs.AUDIO;
}

function getAudioTrackName (track: MediaPlaylist, index: number) {
  const label = track.lang ? `${track.name}/${track.lang}` : track.name;
  return `${label} (${track.attrs['GROUP-ID']}) A-${index}`;
}

function getSubtitlesName (track: MediaPlaylist, index: number) {
  const label = track.lang ? `${track.name}/${track.lang}` : track.name;
  return `${label} (${track.attrs['GROUP-ID']}) S-${index}`;
}

function replaceTimeRangeTuples (timeRanges, data) {
  data.length = 0;
  const { length } = timeRanges;
  for (let i = 0; i < length; i++) {
    data.push([timeRanges.start(i), timeRanges.end(i)]);
  }
}

function getChartOptions () {
  return {
    animation: {
      duration: 0
    },
    elements: {
      rectangle: {
        borderWidth: 1,
        borderColor: 'rgba(20, 20, 20, 1)'
      }
    },
    events: [
      'click', 'touchstart'
    ],
    hover: {
      mode: null,
      animationDuration: 0
    },
    legend: {
      display: false
    },
    maintainAspectRatio: false,

    responsiveAnimationDuration: 0,
    scales: {
      // TODO: additional xAxes for PTS and PDT
      xAxes: [{
        ticks: {
          beginAtZero: true
        }
      }],
      yAxes: [{
        gridLines: {
          display: false
        }
      }]
    },
    tooltips: {
      enabled: false
    },
    plugins: {
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
          rangeMin: {
            x: -10, y: null
          },
          rangeMax: {
            x: null, y: null
          }
        },
        zoom: {
          enabled: true,
          speed: 0.1,
          mode: 'x',
          rangeMin: {
            x: 0, y: null
          },
          rangeMax: {
            x: 60, y: null
          }
        }
      }
    }
  };
}
