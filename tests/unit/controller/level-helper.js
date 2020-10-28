import * as LevelHelper from '../../../src/controller/level-helper';
import LevelDetails from '../../../src/loader/level-details';
import Fragment from '../../../src/loader/fragment';
import LoadStats from '../../../src/loader/load-stats';
import { PlaylistLevelType } from '../../../src/types/loader';

const generatePlaylist = (sequenceNumbers, offset = 0) => {
  const playlist = new LevelDetails('');
  playlist.startSN = sequenceNumbers[0];
  playlist.endSN = sequenceNumbers[sequenceNumbers.length - 1];
  playlist.fragments = sequenceNumbers.map((n, i) => {
    const frag = new Fragment(PlaylistLevelType.MAIN, '');
    frag.sn = n;
    frag.start = i * 5 + offset;
    frag.duration = 5;
    return frag;
  });
  return playlist;
};

const getIteratedSequence = (oldPlaylist, newPlaylist) => {
  const actual = [];
  LevelHelper.mapFragmentIntersection(oldPlaylist, newPlaylist, (oldFrag, newFrag) => {
    if (oldFrag.sn !== newFrag.sn) {
      throw new Error('Expected old frag and new frag to have the same SN');
    }
    actual.push(newFrag.sn);
  });
  return actual;
};

describe('LevelHelper Tests', function () {
  let sandbox;
  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('mapSegmentIntersection', function () {
    it('iterates over the intersection of the fragment arrays', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4, 5]);
      const newPlaylist = generatePlaylist([3, 4, 5, 6, 7]);
      const actual = getIteratedSequence(oldPlaylist, newPlaylist);
      expect(actual).to.deep.equal([3, 4, 5]);
    });

    it('can iterate with one overlapping fragment', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4, 5]);
      const newPlaylist = generatePlaylist([5, 6, 7, 8, 9]);
      const actual = getIteratedSequence(oldPlaylist, newPlaylist);
      expect(actual).to.deep.equal([5]);
    });

    it('can iterate over the entire segment array', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3]);
      const newPlaylist = generatePlaylist([1, 2, 3]);
      const actual = getIteratedSequence(oldPlaylist, newPlaylist);
      expect(actual).to.deep.equal([1, 2, 3]);
    });

    it('can iterate when overlapping happens at the start of the old playlist', function () {
      const oldPlaylist = generatePlaylist([5, 6, 7, 8]);
      const newPlaylist = generatePlaylist([3, 4, 5, 6]);
      const actual = getIteratedSequence(oldPlaylist, newPlaylist);
      expect(actual).to.deep.equal([5, 6]);
    });

    it('never executes the callback if no intersection exists', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4, 5]);
      const newPlaylist = generatePlaylist([10, 11, 12]);
      const actual = getIteratedSequence(oldPlaylist, newPlaylist);
      expect(actual).to.deep.equal([]);
    });
  });

  describe('adjustSliding', function () {
    // generatePlaylist creates fragments with a duration of 5 seconds
    it('adds the start time of the first comment segment to all other segment', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3]); // start times: 0, 5, 10
      const newPlaylist = generatePlaylist([3, 4, 5]);
      LevelHelper.adjustSliding(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([10, 15, 20]);
    });

    it('does not apply sliding if no common segments exist', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3]);
      const newPlaylist = generatePlaylist([5, 6, 7]);
      LevelHelper.adjustSliding(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([0, 5, 10]);
    });

    it('does not apply sliding when segments meet but do not overlap', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3]);
      const newPlaylist = generatePlaylist([4, 5, 6]);
      LevelHelper.adjustSliding(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([0, 5, 10]);
    });
  });

  describe('mergeDetails', function () {
    it('transfers start times where segments overlap, and extrapolates the start of any new segment', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4]); // start times: 0, 5, 10, 15
      const newPlaylist = generatePlaylist([2, 3, 4, 5]);
      LevelHelper.mergeDetails(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([5, 10, 15, 20]);
    });

    it('does not change start times when there is no segment overlap', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3]);
      const newPlaylist = generatePlaylist([5, 6, 7]);
      LevelHelper.mergeDetails(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([0, 5, 10]);
    });

    it('does not extrapolate if the new playlist starts before the old', function () {
      const oldPlaylist = generatePlaylist([3, 4, 5]);
      oldPlaylist.fragments.forEach(f => {
        f.start += 10;
      });
      const newPlaylist = generatePlaylist([1, 2, 3]);
      LevelHelper.mergeDetails(oldPlaylist, newPlaylist);
      const actual = newPlaylist.fragments.map(f => f.start);
      expect(actual).to.deep.equal([0, 5, 10]);
    });

    it('merges delta playlist updates', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const newPlaylist = generatePlaylist([10, 11, 12]);
      newPlaylist.skippedSegments = 7;
      newPlaylist.startSN = 3;
      newPlaylist.fragments.unshift(null, null, null, null, null, null, null);
      const merged = generatePlaylist([3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 10);
      LevelHelper.mergeDetails(oldPlaylist, newPlaylist);
      expect(newPlaylist.deltaUpdateFailed).to.equal(false);
      expect(newPlaylist.fragments.length).to.equal(merged.fragments.length);
      newPlaylist.fragments.forEach((frag, i) => {
        expect(frag, `Fragment sn: ${frag.sn} does not match expected:
actual: ${JSON.stringify(frag)}
expect: ${JSON.stringify(merged.fragments[i])}`).to.deep.equal(merged.fragments[i]);
      });
    });

    it('marks failed delta playlist updates', function () {
      const oldPlaylist = generatePlaylist([1, 2, 3, 4, 5, 6, 7, 8]);
      const newPlaylist = generatePlaylist([10, 11, 12]);
      newPlaylist.skippedSegments = 5;
      newPlaylist.startSN = 5;
      newPlaylist.fragments.unshift(null, null, null, null, null);
      // FIXME: An expected offset of 50 would be preferred, but there is nothing to sync playlist start with
      const merged = generatePlaylist([10, 11, 12], 0);
      LevelHelper.mergeDetails(oldPlaylist, newPlaylist);
      expect(newPlaylist.deltaUpdateFailed).to.equal(true);
      expect(newPlaylist.fragments.length).to.equal(3);
      newPlaylist.fragments.forEach((frag, i) => {
        expect(frag, `Fragment sn: ${frag.sn} does not match expected:
actual: ${JSON.stringify(frag)}
expect: ${JSON.stringify(merged.fragments[i])}`).to.deep.equal(merged.fragments[i]);
      });
    });
  });

  describe('computeReloadInterval', function () {
    it('returns the averagetargetduration of the new level if available', function () {
      const newPlaylist = generatePlaylist([3, 4]);
      newPlaylist.averagetargetduration = 5;
      newPlaylist.updated = true;
      const actual = LevelHelper.computeReloadInterval(newPlaylist, null);
      expect(actual).to.equal(5000);
    });

    it('returns the targetduration of the new level if averagetargetduration is falsy', function () {
      const newPlaylist = generatePlaylist([3, 4]);
      newPlaylist.averagetargetduration = null;
      newPlaylist.targetduration = 4;
      newPlaylist.updated = true;
      let actual = LevelHelper.computeReloadInterval(newPlaylist, null);
      expect(actual).to.equal(4000);

      newPlaylist.averagetargetduration = null;
      actual = LevelHelper.computeReloadInterval(newPlaylist, null);
      expect(actual).to.equal(4000);
    });

    it('halves the reload interval if the playlist contains the same segments', function () {
      const newPlaylist = generatePlaylist([1, 2]);
      newPlaylist.updated = false;
      newPlaylist.averagetargetduration = 5;
      const actual = LevelHelper.computeReloadInterval(newPlaylist, null);
      expect(actual).to.equal(2500);
    });

    it('rounds the reload interval', function () {
      const newPlaylist = generatePlaylist([3, 4]);
      newPlaylist.averagetargetduration = 5.9999;
      newPlaylist.updated = true;
      const actual = LevelHelper.computeReloadInterval(newPlaylist, null);
      expect(actual).to.equal(6000);
    });

    it('subtracts the request time of the last level load from the reload interval', function () {
      const newPlaylist = generatePlaylist([3, 4]);
      newPlaylist.averagetargetduration = 5;
      newPlaylist.updated = true;
      const stats = new LoadStats();
      stats.loading.start = 0;
      stats.loading.end = 1000;
      const actual = LevelHelper.computeReloadInterval(newPlaylist, stats);
      expect(actual).to.equal(4000);
    });

    it('returns a minimum of half the target duration', function () {
      const newPlaylist = generatePlaylist([3, 4]);
      newPlaylist.averagetargetduration = 5;
      newPlaylist.updated = false;
      const stats = new LoadStats();
      stats.loading.start = 0;
      stats.loading.end = 1000;
      const actual = LevelHelper.computeReloadInterval(newPlaylist, stats);
      expect(actual).to.equal(2500);
    });
  });
});