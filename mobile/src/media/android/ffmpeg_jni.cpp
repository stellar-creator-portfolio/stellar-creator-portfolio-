/**
 * media/android/ffmpeg_jni.cpp
 *
 * Android JNI bridge to FFmpeg for hardware-accelerated video trimming.
 * Compile with the mobile-ffmpeg-full-gpl AAR (or ffmpeg-kit-react-native).
 *
 * CMakeLists.txt entry:
 *   add_library(ffmpeg_jni SHARED ffmpeg_jni.cpp)
 *   target_link_libraries(ffmpeg_jni avcodec avformat avutil swscale swresample log)
 */

#include <jni.h>
#include <string>
#include <thread>
#include <android/log.h>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/opt.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>
}

#define LOG_TAG "StellarFFmpeg"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

// ─── Progress callback ────────────────────────────────────────────────────────

static JavaVM*   g_jvm        = nullptr;
static jobject   g_callback   = nullptr;
static jmethodID g_onProgress = nullptr;

static void reportProgress(double progress) {
    if (!g_jvm || !g_callback) return;
    JNIEnv* env = nullptr;
    bool attached = false;
    if (g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) == JNI_EDETACHED) {
        g_jvm->AttachCurrentThread(&env, nullptr);
        attached = true;
    }
    if (env && g_onProgress) {
        env->CallVoidMethod(g_callback, g_onProgress, static_cast<jdouble>(progress));
    }
    if (attached) g_jvm->DetachCurrentThread();
}

// ─── Core trim ────────────────────────────────────────────────────────────────

static int trimVideo(
    const char* inputPath,
    const char* outputPath,
    int64_t     startMs,
    int64_t     endMs,
    int         videoBitrate,
    int         audioBitrate,
    bool        useHardware
) {
    av_log_set_level(AV_LOG_WARNING);

    AVFormatContext* inFmt  = nullptr;
    AVFormatContext* outFmt = nullptr;
    int ret = 0;

    if ((ret = avformat_open_input(&inFmt, inputPath, nullptr, nullptr)) < 0) {
        LOGE("avformat_open_input failed: %d", ret);
        return ret;
    }
    avformat_find_stream_info(inFmt, nullptr);

    avformat_alloc_output_context2(&outFmt, nullptr, nullptr, outputPath);
    if (!outFmt) { LOGE("alloc output context failed"); return AVERROR_UNKNOWN; }

    for (unsigned i = 0; i < inFmt->nb_streams; i++) {
        AVStream* inStream  = inFmt->streams[i];
        AVStream* outStream = avformat_new_stream(outFmt, nullptr);
        if (!outStream) continue;

        if (inStream->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            const char* encoderName = useHardware ? "h264_mediacodec" : "libx264";
            const AVCodec* encoder  = avcodec_find_encoder_by_name(encoderName);
            if (!encoder) encoder   = avcodec_find_encoder_by_name("libx264");

            AVCodecContext* encCtx  = avcodec_alloc_context3(encoder);
            encCtx->width           = inStream->codecpar->width;
            encCtx->height          = inStream->codecpar->height;
            encCtx->time_base       = { 1, 90000 };
            encCtx->framerate       = av_guess_frame_rate(inFmt, inStream, nullptr);
            encCtx->bit_rate        = videoBitrate * 1000LL;
            encCtx->pix_fmt         = AV_PIX_FMT_YUV420P;
            // Use all available cores for encoding
            encCtx->thread_count    = static_cast<int>(std::thread::hardware_concurrency());
            encCtx->thread_type     = FF_THREAD_FRAME | FF_THREAD_SLICE;

            if (!useHardware) {
                av_opt_set(encCtx->priv_data, "preset", "fast",       0);
                av_opt_set(encCtx->priv_data, "tune",   "fastdecode", 0);
            }

            avcodec_open2(encCtx, encoder, nullptr);
            avcodec_parameters_from_context(outStream->codecpar, encCtx);
            avcodec_free_context(&encCtx);

        } else if (inStream->codecpar->codec_type == AVMEDIA_TYPE_AUDIO) {
            avcodec_parameters_copy(outStream->codecpar, inStream->codecpar);
            outStream->codecpar->bit_rate = audioBitrate * 1000LL;
        } else {
            avcodec_parameters_copy(outStream->codecpar, inStream->codecpar);
        }
        outStream->time_base = inStream->time_base;
    }

    int64_t startPts = av_rescale_q(startMs, { 1, 1000 }, { 1, AV_TIME_BASE });
    av_seek_frame(inFmt, -1, startPts, AVSEEK_FLAG_BACKWARD);

    if (!(outFmt->oformat->flags & AVFMT_NOFILE))
        avio_open(&outFmt->pb, outputPath, AVIO_FLAG_WRITE);

    avformat_write_header(outFmt, nullptr);

    AVPacket* pkt        = av_packet_alloc();
    int64_t   durationMs = endMs - startMs;

    while (av_read_frame(inFmt, pkt) >= 0) {
        AVStream* inStream = inFmt->streams[pkt->stream_index];
        int64_t   pktMs    = av_rescale_q(pkt->pts, inStream->time_base, { 1, 1000 });

        if (pktMs < startMs) { av_packet_unref(pkt); continue; }
        if (pktMs > endMs)   { av_packet_unref(pkt); break;    }

        pkt->pts -= av_rescale_q(startMs, { 1, 1000 }, inStream->time_base);
        pkt->dts  = pkt->pts;
        pkt->pos  = -1;

        av_interleaved_write_frame(outFmt, pkt);
        reportProgress(std::min(static_cast<double>(pktMs - startMs) / durationMs, 1.0));
        av_packet_unref(pkt);
    }

    av_packet_free(&pkt);
    av_write_trailer(outFmt);
    avformat_close_input(&inFmt);
    if (outFmt && !(outFmt->oformat->flags & AVFMT_NOFILE)) avio_closep(&outFmt->pb);
    avformat_free_context(outFmt);
    reportProgress(1.0);
    return 0;
}

// ─── JNI exports ─────────────────────────────────────────────────────────────

extern "C" JNIEXPORT jint JNICALL
JNI_OnLoad(JavaVM* vm, void*) {
    g_jvm = vm;
    return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT jint JNICALL
Java_dev_stellar_mobile_FFmpegBridge_trimVideo(
    JNIEnv*  env,
    jclass,
    jstring  inputPath,
    jstring  outputPath,
    jlong    startMs,
    jlong    endMs,
    jint     videoBitrate,
    jint     audioBitrate,
    jboolean useHardware,
    jobject  progressCallback
) {
    g_callback   = env->NewGlobalRef(progressCallback);
    jclass cbCls = env->GetObjectClass(g_callback);
    g_onProgress = env->GetMethodID(cbCls, "onProgress", "(D)V");

    const char* in  = env->GetStringUTFChars(inputPath,  nullptr);
    const char* out = env->GetStringUTFChars(outputPath, nullptr);

    int result = trimVideo(in, out, startMs, endMs, videoBitrate, audioBitrate, useHardware);

    env->ReleaseStringUTFChars(inputPath,  in);
    env->ReleaseStringUTFChars(outputPath, out);
    env->DeleteGlobalRef(g_callback);
    g_callback = nullptr;
    return result;
}
