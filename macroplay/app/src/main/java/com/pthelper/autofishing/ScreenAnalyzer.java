package com.pthelper.autofishing;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Point;

public final class ScreenAnalyzer {
    private ScreenAnalyzer() {}

    /**
     * Samples a square region on a grid and returns the raw pixels.
     *
     * <p>{@code usableWidth} / {@code usableHeight} bound the meaningful area of the bitmap.
     * A capture buffer is allocated at the surface row stride, so it is wider than the frame
     * and the trailing columns hold padding bytes that must never be sampled.
     */
    public static int[] signature(Bitmap bitmap, Point center, int radius, int step,
                                  int usableWidth, int usableHeight) {
        if (bitmap == null || bitmap.isRecycled()) return new int[0];
        int maxX = Math.min(bitmap.getWidth(), usableWidth) - 1;
        int maxY = Math.min(bitmap.getHeight(), usableHeight) - 1;
        if (maxX < 0 || maxY < 0) return new int[0];
        int left = Math.max(0, Math.min(center.x - radius, maxX));
        int top = Math.max(0, Math.min(center.y - radius, maxY));
        int right = Math.min(maxX, center.x + radius);
        int bottom = Math.min(maxY, center.y + radius);
        int safeStep = Math.max(1, step);
        int columns = gridColumns(center, radius, step, usableWidth);
        int rows = Math.max(1, ((bottom - top) / safeStep) + 1);
        int[] output = new int[columns * rows];
        int index = 0;
        for (int y = top; y <= bottom; y += safeStep) {
            for (int x = left; x <= right; x += safeStep) {
                if (index < output.length) output[index++] = bitmap.getPixel(x, y);
            }
        }
        if (index == output.length) return output;
        int[] exact = new int[index];
        System.arraycopy(output, 0, exact, 0, index);
        return exact;
    }

    /** Number of grid columns {@link #signature} produces, so callers can lay the pixels out in 2-D. */
    public static int gridColumns(Point center, int radius, int step, int usableWidth) {
        int maxX = usableWidth - 1;
        if (maxX < 0) return 1;
        int left = Math.max(0, Math.min(center.x - radius, maxX));
        int right = Math.min(maxX, center.x + radius);
        return Math.max(1, ((right - left) / Math.max(1, step)) + 1);
    }

    /**
     * Longest run of the dark blob in grid cells — its length across whichever axis is
     * larger — or 0 when there is no blob worth the name. Returns the extent rather than an
     * area because the game's shadow sprites scale linearly with fish tier.
     */
    public static int shadowExtentCells(int[] pixels, int columns, int darkerBy) {
        if (pixels == null || pixels.length == 0 || columns <= 0) return 0;
        long total = 0;
        for (int pixel : pixels) {
            total += luminance(pixel);
        }
        double threshold = (total / (double) pixels.length) - Math.max(1, darkerBy);
        int minCol = Integer.MAX_VALUE, maxCol = -1, minRow = Integer.MAX_VALUE, maxRow = -1, dark = 0;
        for (int index = 0; index < pixels.length; index++) {
            if (luminance(pixels[index]) >= threshold) continue;
            int col = index % columns;
            int row = index / columns;
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            dark++;
        }
        // A couple of stray dark cells is texture, not a fish.
        if (dark < 3) return 0;
        return Math.max(maxCol - minCol, maxRow - minRow) + 1;
    }

    /**
     * True when enough of the tile is the game's purple rare-card colour. The whole tile is
     * counted — the user-visible cue is a purple background, not just a thin frame.
     */
    public static boolean purpleBackground(int[] pixels, double minShare) {
        if (pixels == null || pixels.length == 0) return false;
        int purple = 0;
        for (int pixel : pixels) {
            if (AutomationPolicy.isPurplePixel(Color.red(pixel), Color.green(pixel), Color.blue(pixel))) {
                purple++;
            }
        }
        return purple >= pixels.length * Math.max(0.05, minShare);
    }

    /**
     * Grade of a bag tile from the colour of its frame. The inner half of the grid is skipped
     * because the item artwork there carries every colour; the frame band is what the game
     * tints by rarity. Majority vote among coloured pixels; if almost nothing is coloured the
     * tile is white (common) or an empty slot depending on brightness.
     */
    public static int dominantRarity(int[] pixels, int columns) {
        if (pixels == null || pixels.length == 0 || columns <= 0) return AutomationPolicy.RARITY_EMPTY;
        if (purpleBackground(pixels, 0.12)) return AutomationPolicy.RARITY_VIP;
        int rows = Math.max(1, pixels.length / columns);
        int[] votes = new int[AutomationPolicy.RARITY_VVIP + 1];
        int considered = 0;
        for (int index = 0; index < pixels.length; index++) {
            int col = index % columns;
            int row = index / columns;
            boolean innerCol = col > columns / 4 && col < columns - 1 - columns / 4;
            boolean innerRow = row > rows / 4 && row < rows - 1 - rows / 4;
            if (innerCol && innerRow) continue;
            int pixel = pixels[index];
            votes[AutomationPolicy.rarityOf(Color.red(pixel), Color.green(pixel), Color.blue(pixel))]++;
            considered++;
        }
        if (considered == 0) return AutomationPolicy.RARITY_EMPTY;
        int colouredBest = AutomationPolicy.RARITY_EMPTY;
        int bestVotes = 0;
        for (int rarity = AutomationPolicy.RARITY_TRENDY; rarity <= AutomationPolicy.RARITY_VVIP; rarity++) {
            if (votes[rarity] > bestVotes) {
                bestVotes = votes[rarity];
                colouredBest = rarity;
            }
        }
        // A tinted frame only needs to cover a fifth of the band to be the tile's grade.
        if (bestVotes * 5 >= considered) {
            return colouredBest;
        }
        return votes[AutomationPolicy.RARITY_COMMON] >= votes[AutomationPolicy.RARITY_EMPTY]
            ? AutomationPolicy.RARITY_COMMON : AutomationPolicy.RARITY_EMPTY;
    }

    public static double difference(int[] first, int[] second) {
        int count = Math.min(first == null ? 0 : first.length, second == null ? 0 : second.length);
        if (count == 0) return 0;
        long total = 0;
        for (int index = 0; index < count; index++) {
            total += Math.abs(Color.red(first[index]) - Color.red(second[index]));
            total += Math.abs(Color.green(first[index]) - Color.green(second[index]));
            total += Math.abs(Color.blue(first[index]) - Color.blue(second[index]));
        }
        return total / (double) (count * 3L);
    }

    /**
     * Fraction of sampled pixels whose own average RGB change reaches the threshold.
     * This catches a compact bite icon that can be diluted by an unchanged background
     * when only the whole-region average is considered.
     */
    public static double changedPixelRatio(int[] first, int[] second, int threshold) {
        int count = Math.min(first == null ? 0 : first.length, second == null ? 0 : second.length);
        if (count == 0) return 0;
        int changed = 0;
        int safeThreshold = Math.max(1, threshold);
        for (int index = 0; index < count; index++) {
            int a = first[index];
            int b = second[index];
            int delta = Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff))
                + Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff))
                + Math.abs((a & 0xff) - (b & 0xff));
            if (delta >= safeThreshold * 3) changed++;
        }
        return changed / (double) count;
    }

    /** Share of bright near-neutral pixels, matching the white bite exclamation mark. */
    public static double whitePixelRatio(int[] pixels) {
        if (pixels == null || pixels.length == 0) return 0;
        int white = 0;
        for (int pixel : pixels) {
            int red = (pixel >> 16) & 0xff;
            int green = (pixel >> 8) & 0xff;
            int blue = pixel & 0xff;
            int maximum = Math.max(red, Math.max(green, blue));
            int minimum = Math.min(red, Math.min(green, blue));
            if (minimum >= 185 && maximum - minimum <= 45) white++;
        }
        return white / (double) pixels.length;
    }

    /** Detects the new vertical white stroke of the bite exclamation mark. */
    public static boolean verticalWhiteCueAppeared(int[] before, int[] after, int columns) {
        int count = Math.min(before == null ? 0 : before.length, after == null ? 0 : after.length);
        if (count == 0 || columns <= 0) return false;
        int rows = (count + columns - 1) / columns;
        for (int column = 0; column < columns; column++) {
            int run = 0;
            for (int row = 0; row < rows; row++) {
                int index = row * columns + column;
                if (index >= count) break;
                boolean newlyWhite = isWhite(after[index]) && !isWhite(before[index]);
                if (newlyWhite) {
                    if (++run >= 3) return true;
                } else {
                    run = 0;
                }
            }
        }
        return false;
    }

    /**
     * Two-stage bite detector. Crisp captures use the full exclamation geometry; captures
     * where glow/anti-aliasing joins the stem and dot use the newly-white vertical-stroke
     * fallback. Both compare against the post-cast baseline, so static HUD artwork is ignored.
     */
    public static boolean biteCueAppeared(int[] before, int[] after, int columns) {
        return exclamationShapeAppeared(before, after, columns)
            || verticalWhiteCueAppeared(before, after, columns);
    }

    /**
     * Image-shape detector for the game's bite mark. It finds two separate newly-white
     * components: a narrow vertical stem and a compact dot directly below it. Comparing
     * against the cast baseline rejects static HUD text, while component geometry rejects
     * water ripples, chat movement and the large controls that fooled colour-difference
     * based detection in IMG_8105.
     */
    public static boolean exclamationShapeAppeared(int[] before, int[] after, int columns) {
        int count = Math.min(before == null ? 0 : before.length, after == null ? 0 : after.length);
        if (count == 0 || columns < 3) return false;
        int rows = count / columns;
        if (rows < 6) return false;
        int usable = rows * columns;
        boolean[] mask = new boolean[usable];
        for (int index = 0; index < usable; index++) {
            mask[index] = isWhite(after[index]) && !isWhite(before[index]);
        }

        int[] labels = new int[usable];
        int[] queue = new int[usable];
        java.util.ArrayList<WhiteComponent> components = new java.util.ArrayList<>();
        int label = 0;
        for (int index = 0; index < usable; index++) {
            if (!mask[index] || labels[index] != 0) continue;
            label++;
            int head = 0, tail = 0;
            queue[tail++] = index;
            labels[index] = label;
            WhiteComponent component = new WhiteComponent();
            while (head < tail) {
                int current = queue[head++];
                int row = current / columns;
                int col = current % columns;
                component.include(col, row);
                for (int dy = -1; dy <= 1; dy++) {
                    for (int dx = -1; dx <= 1; dx++) {
                        if (dx == 0 && dy == 0) continue;
                        int nextRow = row + dy;
                        int nextCol = col + dx;
                        if (nextRow < 0 || nextRow >= rows || nextCol < 0 || nextCol >= columns) continue;
                        int next = nextRow * columns + nextCol;
                        if (mask[next] && labels[next] == 0) {
                            labels[next] = label;
                            queue[tail++] = next;
                        }
                    }
                }
            }
            components.add(component);
        }

        for (WhiteComponent stem : components) {
            if (!stem.isStem()) continue;
            for (WhiteComponent dot : components) {
                if (dot == stem || !dot.isDot()) continue;
                int gap = dot.minRow - stem.maxRow;
                if (gap < 1 || gap > 7) continue;
                if (Math.abs(dot.centerX() - stem.centerX()) <= 2.5d) return true;
            }
            // In IMG_8102 the tall white stem is visible one video frame before its dot.
            // Accept only an unusually tall, narrow and dense stem so ordinary text, ripples
            // and short control highlights cannot take this fast path.
            if (stem.isStrongEarlyStem()) return true;
        }
        return false;
    }

    private static final class WhiteComponent {
        int minCol = Integer.MAX_VALUE;
        int maxCol = -1;
        int minRow = Integer.MAX_VALUE;
        int maxRow = -1;
        int pixels;

        void include(int col, int row) {
            minCol = Math.min(minCol, col);
            maxCol = Math.max(maxCol, col);
            minRow = Math.min(minRow, row);
            maxRow = Math.max(maxRow, row);
            pixels++;
        }

        int width() { return maxCol - minCol + 1; }
        int height() { return maxRow - minRow + 1; }
        double centerX() { return (minCol + maxCol) / 2.0d; }
        boolean isStem() {
            return height() >= 3 && height() <= 18 && width() <= 5
                && height() >= width() * 1.5d && pixels >= height();
        }
        boolean isDot() {
            return width() <= 5 && height() <= 5 && pixels >= 1;
        }
        boolean isStrongEarlyStem() {
            return height() >= 9 && height() <= 18 && width() <= 3
                && height() >= width() * 3.0d
                && pixels >= Math.ceil(width() * height() * 0.55d);
        }
    }

    private static boolean isWhite(int pixel) {
        int red = (pixel >> 16) & 0xff;
        int green = (pixel >> 8) & 0xff;
        int blue = pixel & 0xff;
        int maximum = Math.max(red, Math.max(green, blue));
        int minimum = Math.min(red, Math.min(green, blue));
        return minimum >= 180 && maximum - minimum <= 50;
    }

    /**
     * "Dark" is judged against the region's own average brightness rather than a fixed
     * colour, which keeps shadow detection working across lakes, weather and time of day.
     */
    private static int luminance(int pixel) {
        return (Color.red(pixel) * 299 + Color.green(pixel) * 587 + Color.blue(pixel) * 114) / 1000;
    }

    public static double alertColorRatio(int[] pixels) {
        if (pixels == null || pixels.length == 0) return 0;
        int alerts = 0;
        for (int pixel : pixels) {
            int red = Color.red(pixel);
            int green = Color.green(pixel);
            int blue = Color.blue(pixel);
            boolean redBadge = red >= 165 && red >= green * 1.25 && red >= blue * 1.25;
            boolean orangeBadge = red >= 180 && green >= 65 && green <= 165 && blue <= 95;
            if (redBadge || orangeBadge) alerts++;
        }
        return alerts / (double) pixels.length;
    }

    /** Share of bright cyan pixels used by the game's Bảo quản button. */
    public static double cyanControlRatio(int[] pixels) {
        if (pixels == null || pixels.length == 0) return 0;
        int cyan = 0;
        for (int pixel : pixels) {
            int red = (pixel >> 16) & 0xff;
            int green = (pixel >> 8) & 0xff;
            int blue = pixel & 0xff;
            if (blue >= 150 && green >= 105 && red <= 180
                    && green >= red + 15 && blue >= red + 25) cyan++;
        }
        return cyan / (double) pixels.length;
    }
}
