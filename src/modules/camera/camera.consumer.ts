import {
  KAFKA_TOPICS,
  KAFKA_CONSUMER_GROUPS,
} from "../../common/constants/kafka.constant";
import {
  ppeSiteDeletedKafkaEventSchema,
  ppeSiteDeletedPayloadSchema,
  ppeZoneDeletedKafkaEventSchema,
  ppeZoneDeletedPayloadSchema,
  validateKafkaEvent,
} from "../../common/validations/kafka-event.schema";
import {
  PPESiteDeletedPayload,
  PPEZoneDeletedPayload,
} from "../../common/types/kafka-event.type";
import { cameraService, CameraService } from "./camera.service";

/**
 * Interface kết quả xử lý message của Kafka Consumer
 */
export interface ConsumerProcessResult {
  success: boolean;
  topic: string;
  affectedCount: number;
  error?: string;
}

/**
 * CameraEventConsumer: Lắng nghe và xử lý các sự kiện phân tán từ Kafka Event Bus.
 * SEC-24: Ngăn chặn hiện tượng Orphaned Cameras khi Site hoặc Zone bị xóa trong smart-ppe-site-service.
 */
export class CameraEventConsumer {
  private isRunning = false;

  constructor(private readonly service: CameraService = cameraService) {}

  public get consumerGroup(): string {
    return KAFKA_CONSUMER_GROUPS.CAMERA_SERVICE;
  }

  public get subscribedTopics(): string[] {
    return [KAFKA_TOPICS.PPE_SITE_DELETED, KAFKA_TOPICS.PPE_ZONE_DELETED];
  }

  public get status(): { isRunning: boolean; group: string; topics: string[] } {
    return {
      isRunning: this.isRunning,
      group: this.consumerGroup,
      topics: this.subscribedTopics,
    };
  }

  /**
   * Xử lý thông điệp sự kiện SITE_DELETED từ Kafka.
   * Chấp nhận cả envelope dạng KafkaEvent lẫn raw payload trực tiếp.
   */
  async handleSiteDeletedMessage(
    rawMessage: unknown,
  ): Promise<ConsumerProcessResult> {
    let payload: PPESiteDeletedPayload;

    // 1. Thử parse dạng envelope KafkaEvent chuẩn
    const eventValidation = validateKafkaEvent(
      ppeSiteDeletedKafkaEventSchema,
      rawMessage,
    );
    if (eventValidation.success) {
      payload = eventValidation.data.payload;
    } else {
      // 2. Fallback parse trực tiếp raw payload
      const payloadValidation = validateKafkaEvent(
        ppeSiteDeletedPayloadSchema,
        rawMessage,
      );
      if (payloadValidation.success) {
        payload = payloadValidation.data;
      } else {
        const errors = eventValidation.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          topic: KAFKA_TOPICS.PPE_SITE_DELETED,
          affectedCount: 0,
          error: `Malformed SITE_DELETED event payload: ${errors}`,
        };
      }
    }

    try {
      const result = await this.service.handleSiteDeleted(payload);
      return {
        success: true,
        topic: KAFKA_TOPICS.PPE_SITE_DELETED,
        affectedCount: result.affectedCount,
      };
    } catch (err: any) {
      return {
        success: false,
        topic: KAFKA_TOPICS.PPE_SITE_DELETED,
        affectedCount: 0,
        error: err.message || "Failed to process SITE_DELETED event",
      };
    }
  }

  /**
   * Xử lý thông điệp sự kiện ZONE_DELETED từ Kafka.
   */
  async handleZoneDeletedMessage(
    rawMessage: unknown,
  ): Promise<ConsumerProcessResult> {
    let payload: PPEZoneDeletedPayload;

    const eventValidation = validateKafkaEvent(
      ppeZoneDeletedKafkaEventSchema,
      rawMessage,
    );
    if (eventValidation.success) {
      payload = eventValidation.data.payload;
    } else {
      const payloadValidation = validateKafkaEvent(
        ppeZoneDeletedPayloadSchema,
        rawMessage,
      );
      if (payloadValidation.success) {
        payload = payloadValidation.data;
      } else {
        const errors = eventValidation.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("; ");
        return {
          success: false,
          topic: KAFKA_TOPICS.PPE_ZONE_DELETED,
          affectedCount: 0,
          error: `Malformed ZONE_DELETED event payload: ${errors}`,
        };
      }
    }

    try {
      const result = await this.service.handleZoneDeleted(payload);
      return {
        success: true,
        topic: KAFKA_TOPICS.PPE_ZONE_DELETED,
        affectedCount: result.affectedCount,
      };
    } catch (err: any) {
      return {
        success: false,
        topic: KAFKA_TOPICS.PPE_ZONE_DELETED,
        affectedCount: 0,
        error: err.message || "Failed to process ZONE_DELETED event",
      };
    }
  }

  /**
   * Bộ định tuyến tin nhắn đa topic (Message Dispatcher)
   */
  async dispatchMessage(
    topic: string,
    message: unknown,
  ): Promise<ConsumerProcessResult> {
    switch (topic) {
      case KAFKA_TOPICS.PPE_SITE_DELETED:
        return this.handleSiteDeletedMessage(message);
      case KAFKA_TOPICS.PPE_ZONE_DELETED:
        return this.handleZoneDeletedMessage(message);
      default:
        return {
          success: false,
          topic,
          affectedCount: 0,
          error: `Unsupported consumer topic: ${topic}`,
        };
    }
  }

  /**
   * Khởi chạy Kafka Consumer worker
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(
      `[Kafka Consumer] Subscribed to topics: ${this.subscribedTopics.join(", ")} (Group: ${this.consumerGroup})`,
    );
  }

  /**
   * Dừng Kafka Consumer worker gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log(
      `[Kafka Consumer] Disconnected consumer group ${this.consumerGroup}`,
    );
  }
}

export const defaultCameraEventConsumer = new CameraEventConsumer();
