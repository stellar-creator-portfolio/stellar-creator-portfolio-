// media/ios/StellarFFmpegBridge.m
//
// Objective-C bridge to FFmpeg for iOS video trimming.
// Links against MobileFFmpeg (ffmpeg-kit) framework.
// Place in: ios/StellarFFmpegBridge.m
//
// Podfile entry:
//   pod 'ffmpeg-kit-ios-full-gpl', '~> 6.0'

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <ffmpegkit/FFmpegKit.h>
#import <ffmpegkit/FFmpegKitConfig.h>
#import <ffmpegkit/ReturnCode.h>

@interface StellarFFmpegBridge : NSObject <RCTBridgeModule>
@end

@implementation StellarFFmpegBridge

RCT_EXPORT_MODULE(StellarFFmpeg);

/**
 * Trim a video using FFmpeg with VideoToolbox hardware encoding on iOS.
 *
 * options = {
 *   inputUri:        string,
 *   outputUri:       string,
 *   startMs:         number,
 *   endMs:           number,
 *   videoBitrate:    number,   // kbps
 *   audioBitrate:    number,   // kbps
 *   hardwareEncoding: boolean,
 * }
 */
RCT_EXPORT_METHOD(trimVideo:(NSDictionary *)options
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSString* inputUri   = options[@"inputUri"];
    NSString* outputUri  = options[@"outputUri"];
    long      startMs    = [options[@"startMs"]    longValue];
    long      endMs      = [options[@"endMs"]      longValue];
    int       vBitrate   = [options[@"videoBitrate"] intValue];
    int       aBitrate   = [options[@"audioBitrate"] intValue];
    BOOL      useHW      = [options[@"hardwareEncoding"] boolValue];

    // Convert ms to HH:MM:SS.mmm for FFmpeg -ss / -to flags
    NSString* (^msToTime)(long) = ^NSString*(long ms) {
        long h   = ms / 3600000;
        long m   = (ms % 3600000) / 60000;
        long s   = (ms % 60000)   / 1000;
        long rem = ms % 1000;
        return [NSString stringWithFormat:@"%02ld:%02ld:%02ld.%03ld", h, m, s, rem];
    };

    // Select encoder: h264_videotoolbox (hardware) or libx264 (software)
    NSString* videoEncoder = useHW ? @"h264_videotoolbox" : @"libx264";

    // Build FFmpeg command
    // -ss before -i for fast seek; -to is relative to -ss when placed after
    NSString* cmd = [NSString stringWithFormat:
        @"-y -ss %@ -to %@ -i \"%@\" "
        @"-c:v %@ -b:v %dk "
        @"-c:a aac -b:a %dk "
        @"-movflags +faststart "   // moov atom at front for streaming
        @"\"%@\"",
        msToTime(startMs),
        msToTime(endMs),
        inputUri,
        videoEncoder, vBitrate,
        aBitrate,
        outputUri
    ];

    NSDate* startTime = [NSDate date];

    // Enable statistics callback for progress reporting
    [FFmpegKitConfig enableStatisticsCallback:^(Statistics* stats) {
        // stats.getTime() returns encoded duration in ms
        long encodedMs   = [stats getTime];
        long durationMs  = endMs - startMs;
        if (durationMs > 0) {
            double progress = MIN(1.0, (double)encodedMs / durationMs);
            // Emit progress event to JS via RCTEventEmitter (wired separately)
            NSLog(@"[StellarFFmpeg] progress: %.2f", progress);
        }
    }];

    [FFmpegKit executeAsync:cmd withCompleteCallback:^(FFmpegSession* session) {
        ReturnCode* rc = [session getReturnCode];

        if ([ReturnCode isSuccess:rc]) {
            NSTimeInterval elapsed = [[NSDate date] timeIntervalSinceDate:startTime] * 1000;

            // Get output file size
            NSDictionary* attrs = [[NSFileManager defaultManager]
                attributesOfItemAtPath:outputUri error:nil];
            long long fileSize = [attrs[NSFileSize] longLongValue];

            resolve(@{
                @"outputUri":     outputUri,
                @"durationMs":    @(endMs - startMs),
                @"fileSizeBytes": @(fileSize),
                @"processingMs":  @((long)elapsed),
            });
        } else {
            NSString* logs = [session getLogsAsString];
            reject(@"FFMPEG_ERROR",
                   [NSString stringWithFormat:@"FFmpeg failed (rc=%d)", [rc getValue]],
                   [NSError errorWithDomain:@"StellarFFmpeg"
                                      code:[rc getValue]
                                  userInfo:@{ NSLocalizedDescriptionKey: logs }]);
        }
    }];
}

@end
