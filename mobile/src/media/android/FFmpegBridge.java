// media/android/FFmpegBridge.java
//
// Java side of the JNI bridge. Loaded by the React Native TurboModule.
// Place in: android/app/src/main/java/dev/stellar/mobile/FFmpegBridge.java

package dev.stellar.mobile;

public class FFmpegBridge {

    static {
        System.loadLibrary("ffmpeg_jni");
    }

    public interface ProgressCallback {
        void onProgress(double progress); // 0.0 – 1.0
    }

    /**
     * Trim a video file natively via FFmpeg.
     *
     * @param inputPath      Absolute path to source video
     * @param outputPath     Absolute path for trimmed output
     * @param startMs        Trim start in milliseconds
     * @param endMs          Trim end in milliseconds
     * @param videoBitrate   Target video bitrate in kbps
     * @param audioBitrate   Target audio bitrate in kbps
     * @param useHardware    Use MediaCodec hardware encoder when available
     * @param callback       Progress callback (called on encoding thread)
     * @return               0 on success, negative FFmpeg error code on failure
     */
    public static native int trimVideo(
        String           inputPath,
        String           outputPath,
        long             startMs,
        long             endMs,
        int              videoBitrate,
        int              audioBitrate,
        boolean          useHardware,
        ProgressCallback callback
    );
}
